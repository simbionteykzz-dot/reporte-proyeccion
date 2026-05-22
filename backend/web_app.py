# -*- coding: utf-8 -*-
from __future__ import annotations

import hmac
import json
import logging
import os
import time
import xmlrpc.client
from collections import OrderedDict
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from flask import Flask, Response, jsonify, redirect, request, send_from_directory, session
from flask_cors import CORS
from werkzeug.security import check_password_hash

from odoo_connector import (
    config_from_environ,
    dotenv_file_status,
    dotenv_package_available,
    is_configured,
    missing_config_keys,
    sale_order_nota_lookup,
    sale_order_nota_pdf_bytes,
    sale_order_nota_pdf_bytes_by_id,
    order_details_for_receipt_by_name,
    sale_order_accounts_receivable_by_documents,
)

from analytics import (
    company_id_allowed,
    generate_consolidado_ingresos_payload,
    generate_dashboard_payload,
    generate_inventory_risks_payload,
    get_companies_for_dashboard_user,
    generate_pos_geographic_payload,
    generate_product_dashboard_payload,
)
from supabase.client import (
    fetch_zazu_envios,
    fetch_courier_tables_summary,
    fetch_provincia_envios,
    supabase_health_payload,
)
from shalom_client import build_tracking_url, get_shalom_config

# Raiz del repo (padre de /backend): public/, .env
REPO_ROOT = Path(__file__).resolve().parent.parent
PUBLIC_DIR = REPO_ROOT / "public"
# Un solo origen de estaticos con public/ (local + Vercel CDN)
ASSETS_DIR = REPO_ROOT / "public" / "assets"

# Cargar .env antes de leer FLASK_SECRET_KEY / credenciales del panel
missing_config_keys()


def _load_api_folder_dotenv() -> None:
    """Carga api/.env del repo (p. ej. variables de Supabase)."""
    try:
        from dotenv import load_dotenv
    except ImportError:
        return
    p = REPO_ROOT / "api" / ".env"
    if not p.is_file():
        return
    try:
        load_dotenv(p, override=False, encoding="utf-8-sig")
    except TypeError:
        load_dotenv(p, override=False)


_load_api_folder_dotenv()

app = Flask(__name__, static_folder=str(ASSETS_DIR), static_url_path="/assets")

_IS_DEV = os.environ.get("FLASK_DEBUG", "").strip().lower() in ("1", "true", "yes")
_SECRET_KEY = os.environ.get("FLASK_SECRET_KEY", "").strip()
if not _SECRET_KEY:
    if _IS_DEV:
        _SECRET_KEY = "dev-only-INSECURE-do-not-use-in-prod"
    else:
        raise RuntimeError(
            "FLASK_SECRET_KEY no está definida. Es obligatoria en producción "
            "(firma de cookies de sesión). Configúrala en Vercel/.env y reintenta."
        )
app.secret_key = _SECRET_KEY

app.config["PERMANENT_SESSION_LIFETIME"] = timedelta(days=7)
app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SAMESITE"] = "Strict"
# En producción la cookie debe viajar solo por HTTPS. Permite override explícito a False solo para desarrollo.
_cookie_secure_env = os.environ.get("SESSION_COOKIE_SECURE", "").strip().lower()
if _cookie_secure_env in ("0", "false", "no"):
    app.config["SESSION_COOKIE_SECURE"] = False
else:
    app.config["SESSION_COOKIE_SECURE"] = not _IS_DEV

# CORS cerrado por defecto: la SPA se sirve desde el mismo origen Flask, no necesita CORS.
# Para activarlo definir ALLOWED_ORIGINS="https://dominio1,https://dominio2" en el entorno.
_cors_origins_raw = os.environ.get("ALLOWED_ORIGINS", "").strip()
if _cors_origins_raw:
    _cors_origins = [o.strip() for o in _cors_origins_raw.split(",") if o.strip()]
    CORS(app, origins=_cors_origins, supports_credentials=True)

logging.basicConfig(
    level=logging.DEBUG if _IS_DEV else logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)


def _internal_error(exc: BaseException, *, context: str = ""):
    """Loguea la excepción al servidor y devuelve un 500 genérico sin filtrar detalles internos."""
    app.logger.exception("Error interno%s", f" [{context}]" if context else "")
    return jsonify({"error": "Error interno del servidor."}), 500


class TTLCache:
    """
    Caché en memoria con TTL y tamaño máximo. Reemplaza un dict simple sin
    cambiar el call-site (`x in cache`, `cache[k]`, `cache[k] = v`).

    Motivo: un dict global crecía sin límite (memory leak en procesos de larga
    vida) y nunca expiraba (los datos quedaban rancios indefinidamente, sobre
    todo entre cold-starts en serverless donde la primera petición tras un
    despertar tomaba siempre la copia obsoleta de la instancia previa).
    """

    def __init__(self, *, ttl_seconds: int, maxsize: int) -> None:
        self._ttl = max(1, int(ttl_seconds))
        self._maxsize = max(1, int(maxsize))
        self._store: "OrderedDict[str, tuple[float, Any]]" = OrderedDict()

    def _expired(self, ts: float) -> bool:
        return (time.monotonic() - ts) > self._ttl

    def __contains__(self, key: str) -> bool:
        entry = self._store.get(key)
        if entry is None:
            return False
        if self._expired(entry[0]):
            self._store.pop(key, None)
            return False
        return True

    def __getitem__(self, key: str) -> Any:
        ts, value = self._store[key]
        if self._expired(ts):
            self._store.pop(key, None)
            raise KeyError(key)
        # Renueva orden de uso (acerca al MRU); no reinicia el TTL.
        self._store.move_to_end(key)
        return value

    def __setitem__(self, key: str, value: Any) -> None:
        if key in self._store:
            self._store.move_to_end(key)
        self._store[key] = (time.monotonic(), value)
        while len(self._store) > self._maxsize:
            self._store.popitem(last=False)


_CACHE_TTL_SECONDS = int(os.environ.get("DASHBOARD_CACHE_TTL_SECONDS", "600"))
_CACHE_MAXSIZE = int(os.environ.get("DASHBOARD_CACHE_MAXSIZE", "64"))

DASHBOARD_CACHE = TTLCache(ttl_seconds=_CACHE_TTL_SECONDS, maxsize=_CACHE_MAXSIZE)


def _env_strip(name: str) -> str:
    """Evita fallos por espacios o saltos al pegar variables en Vercel."""
    return (os.environ.get(name) or "").strip()


def _dashboard_user_entries() -> list[dict[str, str]]:
    """
    Usuarios del panel como dicts con email + (password_hash | password).

    Acepta dos formatos en cada entrada (preferencia: hash):
      {"email": "...", "password_hash": "pbkdf2:sha256:..."}   ← recomendado
      {"email": "...", "password": "clave_en_texto"}           ← legacy

    Prioridad de fuentes:
      1. DASHBOARD_USERS = JSON array (multi-usuario)
      2. DASHBOARD_LOGIN_EMAIL + DASHBOARD_PASSWORD_HASH (single-user, hash)
      3. DASHBOARD_LOGIN_EMAIL + DASHBOARD_PASSWORD       (single-user, legacy)

    Para generar un hash:
      python -m hash_password "mi_password"
    """
    out: list[dict[str, str]] = []
    raw = _env_strip("DASHBOARD_USERS")
    if raw:
        try:
            data = json.loads(raw)
            if isinstance(data, list):
                for item in data:
                    if not isinstance(item, dict):
                        continue
                    em = (item.get("email") or "").strip().lower()
                    if not em:
                        continue
                    ph = (item.get("password_hash") or "").strip()
                    if ph:
                        out.append({"email": em, "password_hash": ph})
                        continue
                    pw = (item.get("password") or "").strip()
                    if pw:
                        out.append({"email": em, "password": pw})
        except (json.JSONDecodeError, TypeError, ValueError):
            pass
    if out:
        return out
    # Fallback single-user legacy
    em = _env_strip("DASHBOARD_LOGIN_EMAIL").lower()
    if em:
        ph = _env_strip("DASHBOARD_PASSWORD_HASH")
        if ph:
            out.append({"email": em, "password_hash": ph})
        else:
            pw = _env_strip("DASHBOARD_PASSWORD")
            if pw:
                out.append({"email": em, "password": pw})
    return out


def _check_user_password(given: str, entry: dict[str, str]) -> bool:
    """Valida la password del usuario. Soporta hash (werkzeug) y texto plano (legacy)."""
    if not given:
        return False
    ph = entry.get("password_hash")
    if ph:
        try:
            return check_password_hash(ph, given)
        except Exception:
            app.logger.exception("Hash de password invalido en DASHBOARD_USERS")
            return False
    pw = entry.get("password")
    if pw:
        try:
            return hmac.compare_digest(given.encode("utf-8"), pw.encode("utf-8"))
        except (ValueError, TypeError):
            return False
    return False


def _auth_configured() -> bool:
    """Si hay al menos un usuario de panel definido, se exige login."""
    return len(_dashboard_user_entries()) > 0


def _dashboard_auth_env_ok() -> bool:
    """True si hay usuarios configurados (sin revelar valores)."""
    return len(_dashboard_user_entries()) > 0


def _users_with_plaintext_count() -> int:
    """Cuántos usuarios siguen guardados en texto plano (para nudge de migración)."""
    return sum(1 for u in _dashboard_user_entries() if "password" in u and "password_hash" not in u)


def _dashboard_session_ok() -> bool:
    return bool(session.get("dashboard_ok"))


def _match_name_only_from_request() -> bool:
    """
    Por defecto True: PDF y lookup vinculan solo con sale.order.name (Nota de venta).
    match_name_only=0 | false | no | off — también busca client_order_ref.
    """
    v = (request.args.get("match_name_only") or "1").strip().lower()
    return v not in ("0", "false", "no", "off")


def _odoo_diagnostic_key_authorized() -> bool:
    """
    Deshabilitado: la versión anterior permitía bypass de autenticación con
    ?diag_key=... por query string. Las query strings se filtran en logs de
    servidor, en cabeceras Referer y en historial del navegador, por lo que
    no es un canal seguro para una credencial. Si se necesita diagnóstico,
    iniciar sesión normalmente como cualquier usuario del panel.
    """
    return False


# En producción la app NUNCA debe arrancar sin autenticación configurada:
# de lo contrario el middleware deja pasar todas las peticiones (panel abierto).
if not _auth_configured():
    if _IS_DEV:
        app.logger.warning(
            "DASHBOARD_USERS / DASHBOARD_LOGIN_EMAIL vacíos: el panel está SIN AUTENTICACIÓN. "
            "Aceptable solo en desarrollo local."
        )
    else:
        raise RuntimeError(
            "No hay usuarios de panel configurados (DASHBOARD_USERS o "
            "DASHBOARD_LOGIN_EMAIL/DASHBOARD_PASSWORD). Negativa a arrancar en producción "
            "para no exponer el panel sin autenticación."
        )

# Aviso suave si quedan passwords en texto plano (migración recomendada a password_hash).
_plain_count = _users_with_plaintext_count()
if _plain_count > 0:
    app.logger.warning(
        "%d usuario(s) del panel siguen con password en TEXTO PLANO. "
        "Migrar a password_hash: `python -m hash_password 'tu_clave'` y reemplazar "
        "la variable de entorno. La password en texto sigue funcionando pero queda visible "
        "a cualquiera con acceso a las variables (Vercel UI, logs, auditoría).",
        _plain_count,
    )


@app.before_request
def _require_dashboard_auth():
    if not _auth_configured():
        return None
    path = request.path or ""
    if path.startswith("/assets/"):
        return None
    # Formulario estatico en /login.html (CDN); /login solo redirige
    if path in ("/login", "/login.html") and request.method == "GET":
        return None
    if path.startswith("/api/auth/"):
        return None
    if path in ("/api/health", "/api/supabase/health"):
        return None
    if _odoo_diagnostic_key_authorized():
        return None
    if _dashboard_session_ok():
        return None
    if path.startswith("/api/"):
        return jsonify({"error": "No autenticado", "login": "/login.html"}), 401
    return redirect("/login.html")


def _request_dates() -> tuple[str | None, str | None]:
    df = request.args.get("date_from", "").strip() or None
    dt = request.args.get("date_to", "").strip() or None
    return (df[:10] if df else None, dt[:10] if dt else None)


def _request_company_id() -> int | None:
    raw = request.args.get("company_id", "").strip()
    if not raw:
        return None
    try:
        return int(raw)
    except ValueError:
        raise ValueError("company_id invalido") from None


def _request_bravos_tab() -> bool:
    """Pestaña Bravos en el dashboard: activa agregación por plantillas (3 líneas)."""
    raw = request.args.get("bravos", "").strip().lower()
    return raw in ("1", "true", "yes")


# ── Pages ──

@app.route("/login")
def login_page():
    """El HTML real se sirve como /login.html (public/ en CDN). Evita 404 en serverless sin public/ en el bundle."""
    return redirect("/login.html", code=302)


@app.route("/login.html")
def login_html_fallback():
    """Si el rewrite llega antes que el CDN estatico, servir el HTML desde public/ (includeFiles)."""
    resp = send_from_directory(str(PUBLIC_DIR), "login.html")
    resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    return resp


@app.route("/")
def index():
    # En Vercel el HTML debe servirse desde public/ (CDN); send_from_directory aqui suele dar 404 sin bundle extra.
    r = redirect("/dashboard.html", code=302)
    r.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    return r


@app.route("/dashboard.html")
def dashboard_html_page():
    """Local: sirve desde public/. En Vercel suele atenderlo el CDN antes que Flask."""
    resp = send_from_directory(str(PUBLIC_DIR), "dashboard.html")
    resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    return resp


# ── API auth (credenciales solo en variables de entorno; nunca en el cliente) ──

@app.route("/api/auth/login", methods=["POST"])
def api_auth_login():
    entries = _dashboard_user_entries()
    if not entries:
        return jsonify({"ok": True, "auth_disabled": True})
    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""
    for entry in entries:
        if email == entry["email"] and _check_user_password(password, entry):
            session.permanent = True
            session["dashboard_ok"] = True
            return jsonify({"ok": True})
    return jsonify({"error": "Credenciales incorrectas"}), 401


@app.route("/api/auth/logout", methods=["POST"])
def api_auth_logout():
    session.clear()
    return jsonify({"ok": True})


@app.route("/api/auth/status")
def api_auth_status():
    return jsonify({
        "auth_required": _auth_configured(),
        "authenticated": _dashboard_session_ok() if _auth_configured() else True,
    })


# ── API ──

@app.route("/api/health")
def health():
    """
    Healthcheck. Para clientes sin sesión devuelve solo {ok, time} (suficiente
    para los probes de Vercel). Si hay sesión activa, devuelve el detalle de
    configuración (status de Odoo/Supabase/auth/secret/etc.) para diagnóstico.
    """
    base = {
        "ok": True,
        "time": datetime.now().isoformat(timespec="seconds"),
    }
    if not _dashboard_session_ok():
        return jsonify(base)

    dash_html = PUBLIC_DIR / "dashboard.html"
    login_html = PUBLIC_DIR / "login.html"
    supabase_status = supabase_health_payload()
    base.update({
        "odoo_configured": is_configured(),
        "missing_keys": missing_config_keys(),
        "python_dotenv_installed": dotenv_package_available(),
        "dotenv_files": dotenv_file_status(),
        "deployment": {
            "public_dir_exists": PUBLIC_DIR.is_dir(),
            "dashboard_html_on_disk": dash_html.is_file(),
            "login_html_on_disk": login_html.is_file(),
            "dashboard_auth_env_ok": _dashboard_auth_env_ok(),
            "dashboard_users_count": len(_dashboard_user_entries()),
            "flask_secret_key_set": bool(_env_strip("FLASK_SECRET_KEY")),
            "supabase_configured": supabase_status["configured"],
        },
    })
    return jsonify(base)


@app.route("/api/supabase/health")
def api_supabase_health():
    payload = supabase_health_payload()
    # Always return 200 for configuration diagnostics; status is in payload.configured.
    return jsonify(payload), 200


@app.route("/api/supabase/zazu-envios")
def api_supabase_zazu_envios():
    try:
        tab = (request.args.get("tab") or "entregados").strip().lower()
        table = (request.args.get("table") or "").strip() or None
        raw_limit = (request.args.get("limit") or "200").strip()
        limit = int(raw_limit) if raw_limit else 200
        raw_offset = (request.args.get("offset") or "0").strip()
        offset = int(raw_offset) if raw_offset else 0
        date_from = (request.args.get("date_from") or "").strip() or None
        date_to = (request.args.get("date_to") or "").strip() or None
        payload = fetch_zazu_envios(
            tab=tab,
            table=table,
            limit=limit,
            offset=offset,
            date_from=date_from,
            date_to=date_to,
        )
        resp = jsonify(payload)
        resp.headers["Cache-Control"] = "no-store"
        return resp
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except RuntimeError as e:
        return jsonify({"error": str(e)}), 502
    except Exception as e:
        return _internal_error(e)


@app.route("/api/supabase/courier-summary")
def api_supabase_courier_summary():
    try:
        raw_max = (request.args.get("max_rows_per_table") or "5000").strip()
        max_rows = int(raw_max) if raw_max else 5000
        payload = fetch_courier_tables_summary(max_rows_per_table=max_rows)
        resp = jsonify(payload)
        resp.headers["Cache-Control"] = "no-store"
        return resp
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except RuntimeError as e:
        return jsonify({"error": str(e)}), 502
    except Exception as e:
        return _internal_error(e)


@app.route("/api/supabase/provincia-envios")
def api_supabase_provincia_envios():
    try:
        table = (request.args.get("table") or "__ALL_PROV__").strip()
        raw_limit = (request.args.get("limit") or "300").strip()
        limit = int(raw_limit) if raw_limit else 300
        raw_offset = (request.args.get("offset") or "0").strip()
        offset = int(raw_offset) if raw_offset else 0
        date_from = (request.args.get("date_from") or "").strip() or None
        date_to = (request.args.get("date_to") or "").strip() or None
        estado = (request.args.get("estado") or "").strip() or None
        salida_almacen = (request.args.get("salida_almacen") or "").strip() or None
        guia_query = (request.args.get("guia_query") or "").strip() or None
        payload = fetch_provincia_envios(
            table=table,
            date_from=date_from,
            date_to=date_to,
            estado=estado,
            salida_almacen=salida_almacen,
            guia_query=guia_query,
            limit=limit,
            offset=offset,
        )
        # Enriquecer con datos Odoo usando nota_odoo como referencia (nota_venta > numero_nota > id_venta).
        if is_configured():
            rows_with_ref = [
                (r, str(r.get("nota_odoo") or r.get("id_venta") or "").strip())
                for r in payload.get("rows", [])
            ]
            refs = list(dict.fromkeys(ref for _, ref in rows_with_ref if ref))
            if refs:
                try:
                    cfg = config_from_environ()
                    extra = sale_order_accounts_receivable_by_documents(
                        cfg, refs, match_name_only=False
                    )
                    for r, ref in rows_with_ref:
                        if ref and ref in extra:
                            r["odoo"] = extra[ref]
                except Exception:
                    # Si falla Odoo, no romper el listado principal de provincia,
                    # pero registrar la causa para que sea diagnosticable.
                    app.logger.exception(
                        "Enriquecimiento Odoo en provincia-envios falló (refs=%d)",
                        len(refs),
                    )
        resp = jsonify(payload)
        resp.headers["Cache-Control"] = "no-store"
        return resp
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except RuntimeError as e:
        return jsonify({"error": str(e)}), 502
    except Exception as e:
        return _internal_error(e)



@app.route("/api/companies")
def api_companies():
    """Compañías accesibles para el usuario API + detección de línea Bravos."""
    if not is_configured():
        return jsonify({
            "error": "Faltan variables ODOO en .env",
            "missing_keys": missing_config_keys(),
        }), 503
    try:
        ctx = get_companies_for_dashboard_user()
        resp = jsonify(ctx)
        resp.headers["Cache-Control"] = "no-store"
        return resp
    except RuntimeError as e:
        return jsonify({"error": str(e)}), 502
    except xmlrpc.client.Fault as e:
        return jsonify({"error": f"Odoo: {e.faultString}"}), 502
    except OSError as e:
        return jsonify({"error": f"Red / conexion: {e}"}), 502
    except Exception as e:
        return _internal_error(e)


@app.route("/api/dashboard/consolidado-ingresos")
def api_dashboard_consolidado_ingresos():
    """Ingresos proyectados por empresa (producción, Bravos, Box Prime) + familias para desglose."""
    if not is_configured():
        return jsonify({
            "error": "Faltan variables ODOO en .env",
            "missing_keys": missing_config_keys(),
        }), 503
    try:
        date_from, date_to = _request_dates()
        payload = generate_consolidado_ingresos_payload(date_from, date_to)
        resp = jsonify(payload)
        resp.headers["Cache-Control"] = "no-store"
        return resp
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except RuntimeError as e:
        return jsonify({"error": str(e)}), 502
    except xmlrpc.client.Fault as e:
        return jsonify({"error": f"Odoo: {e.faultString}"}), 502
    except OSError as e:
        return jsonify({"error": f"Red / conexion: {e}"}), 502
    except Exception as e:
        return _internal_error(e)


PRODUCT_DASHBOARD_CACHE = TTLCache(ttl_seconds=_CACHE_TTL_SECONDS, maxsize=_CACHE_MAXSIZE)

@app.route("/api/dashboard/productos")
def api_dashboard_productos():
    """Dashboard multiempresa enfocado en productos."""
    if not is_configured():
        return jsonify({
            "error": "Faltan variables ODOO en .env",
            "missing_keys": missing_config_keys(),
        }), 503
    try:
        date_from, date_to = _request_dates()
        company_id_str = request.args.get("company_id", "").strip() or None
        force_refresh = request.args.get("force_refresh", "0") == "1"

        if company_id_str is not None:
            ctx = get_companies_for_dashboard_user()
            if not company_id_allowed(int(company_id_str), ctx["companies"]):
                return jsonify({"error": "company_id no permitido para este usuario"}), 403

        cache_key = f"{date_from}_{date_to}_{company_id_str}"
        if not force_refresh and cache_key in PRODUCT_DASHBOARD_CACHE:
            payload = PRODUCT_DASHBOARD_CACHE[cache_key]
        else:
            payload = generate_product_dashboard_payload(date_from, date_to, company_id_str)
            PRODUCT_DASHBOARD_CACHE[cache_key] = payload

        resp = jsonify(payload)
        resp.headers["Cache-Control"] = "no-store"
        return resp
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except RuntimeError as e:
        return jsonify({"error": str(e)}), 502
    except xmlrpc.client.Fault as e:
        return jsonify({"error": f"Odoo: {e.faultString}"}), 502
    except OSError as e:
        return jsonify({"error": f"Red / conexion: {e}"}), 502
    except Exception as e:
        return _internal_error(e, context="dashboard/productos")


@app.route("/api/dashboard")
def api_dashboard():
    """Main endpoint: returns full dashboard payload with real Odoo data."""
    if not is_configured():
        return jsonify({
            "error": "Faltan variables ODOO en .env",
            "missing_keys": missing_config_keys(),
        }), 503
    try:
        date_from, date_to = _request_dates()
        company_id = _request_company_id()
        bravos_tab = _request_bravos_tab()
        force_refresh = request.args.get("force_refresh", "0") == "1"

        if company_id is not None:
            ctx = get_companies_for_dashboard_user()
            if not company_id_allowed(company_id, ctx["companies"]):
                return jsonify({"error": "company_id no permitido para este usuario"}), 403

        cache_key = f"{date_from}_{date_to}_{company_id}_{bravos_tab}"
        if not force_refresh and cache_key in DASHBOARD_CACHE:
            payload = DASHBOARD_CACHE[cache_key]
            # Agregar indicador de que viene del caché del servidor
            payload["_server_cached"] = True
            return jsonify(payload)

        payload = generate_dashboard_payload(
            date_from,
            date_to,
            company_id=company_id,
            bravos_tab=bravos_tab,
        )
        DASHBOARD_CACHE[cache_key] = payload
        return jsonify(payload)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except RuntimeError as e:
        return jsonify({"error": str(e)}), 502
    except xmlrpc.client.Fault as e:
        return jsonify({"error": f"Odoo: {e.faultString}"}), 502
    except OSError as e:
        return jsonify({"error": f"Red / conexion: {e}"}), 502
    except Exception as e:
        return _internal_error(e)


@app.route("/api/pos/geographic")
def api_pos_geographic():
    """Segmentación geográfica de pos.order: departamento, distrito, ciudad."""
    if not is_configured():
        return jsonify({
            "error": "Faltan variables ODOO en .env",
            "missing_keys": missing_config_keys(),
        }), 503
    try:
        date_from, date_to = _request_dates()
        company_id = _request_company_id()
        payload = generate_pos_geographic_payload(
            date_from=date_from,
            date_to=date_to,
            company_id=company_id,
        )
        resp = jsonify(payload)
        resp.headers["Cache-Control"] = "no-store"
        return resp
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except RuntimeError as e:
        return jsonify({"error": str(e)}), 502
    except xmlrpc.client.Fault as e:
        return jsonify({"error": f"Odoo: {e.faultString}"}), 502
    except OSError as e:
        return jsonify({"error": f"Red / conexion: {e}"}), 502
    except Exception as e:
        return _internal_error(e)


@app.route("/api/inventory-risks")
def api_inventory_risks():
    """Stock por variante + marca y buckets de riesgo (mismos filtros que /api/dashboard)."""
    if not is_configured():
        return jsonify({
            "error": "Faltan variables ODOO en .env",
            "missing_keys": missing_config_keys(),
        }), 503
    try:
        date_from, date_to = _request_dates()
        company_id = _request_company_id()
        if company_id is not None:
            ctx = get_companies_for_dashboard_user()
            if not company_id_allowed(company_id, ctx["companies"]):
                return jsonify({"error": "company_id no permitido para este usuario"}), 403
        payload = generate_inventory_risks_payload(
            date_from,
            date_to,
            company_id=company_id,
            bravos_tab=_request_bravos_tab(),
        )
        resp = jsonify(payload)
        resp.headers["Cache-Control"] = "no-store"
        return resp
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except RuntimeError as e:
        return jsonify({"error": str(e)}), 502
    except xmlrpc.client.Fault as e:
        return jsonify({"error": f"Odoo: {e.faultString}"}), 502
    except OSError as e:
        return jsonify({"error": f"Red / conexion: {e}"}), 502
    except Exception as e:
        return _internal_error(e)


@app.route("/api/odoo/sale-order-lookup")
def api_odoo_sale_order_lookup():
    """
    Diagnóstico JSON: sale.order para el texto de nota (por defecto solo sale.order.name).
    Query: match_name_only=0 para incluir client_order_ref. Misma auth que el resto del panel.
    """
    if not is_configured():
        return jsonify({
            "error": "Faltan variables ODOO en .env",
            "missing_keys": missing_config_keys(),
        }), 503
    raw = (
        request.args.get("nota")
        or request.args.get("name")
        or request.args.get("id_envio")
        or ""
    ).strip()
    if not raw:
        return jsonify({"error": "Indica nota, name o id_envio."}), 400
    try:
        cfg = config_from_environ()
        payload = sale_order_nota_lookup(
            cfg, raw, match_name_only=_match_name_only_from_request()
        )
        resp = jsonify(payload)
        resp.headers["Cache-Control"] = "no-store"
        return resp
    except xmlrpc.client.Fault as e:
        return jsonify({"error": f"Odoo: {e.faultString}"}), 502
    except OSError as e:
        return jsonify({"error": f"Red / conexión: {e}"}), 502
    except Exception as e:
        return _internal_error(e)


@app.route("/api/odoo/nota-venta-pdf")
def api_odoo_nota_venta_pdf():
    """
    PDF de nota de venta generado en Odoo (XML-RPC: sale.order + ir.actions.report).
    No usa Supabase: este endpoint solo consulta Odoo.

    Query (prioridad):
      sale_order_id=123 — id interno sale.order en la BD Odoo.
      nota= / name= / id_envio= — Nota de venta = sale.order.name (por defecto solo ese campo).
      match_name_only=0 — además buscar en client_order_ref (Referencia del cliente).
    """
    if not is_configured():
        return jsonify({
            "error": "Faltan variables ODOO en .env",
            "missing_keys": missing_config_keys(),
        }), 503
    so_raw = (request.args.get("sale_order_id") or request.args.get("so_id") or "").strip()
    raw_name = (
        request.args.get("nota")
        or request.args.get("name")
        or request.args.get("id_envio")
        or ""
    ).strip()
    if so_raw:
        try:
            sale_order_id = int(so_raw)
        except ValueError:
            return jsonify({"error": "sale_order_id debe ser un entero (id de sale.order en Odoo)."}), 400
        if sale_order_id < 1:
            return jsonify({"error": "sale_order_id debe ser positivo."}), 400
    elif raw_name:
        sale_order_id = None
    else:
        return jsonify({
            "error": "Indica sale_order_id (entero en Odoo) o nota / name / id_envio (número de nota de venta).",
        }), 400
    try:
        cfg = config_from_environ()
        if sale_order_id is not None:
            pdf, filename = sale_order_nota_pdf_bytes_by_id(cfg, sale_order_id)
        else:
            pdf, filename = sale_order_nota_pdf_bytes(
                cfg, raw_name, match_name_only=_match_name_only_from_request()
            )
        return Response(
            pdf,
            mimetype="application/pdf",
            headers={
                "Content-Disposition": f'inline; filename="{filename}"',
                "Cache-Control": "private, max-age=120",
            },
        )
    except ValueError as e:
        # 422: pedido no encontrado en Odoo (no confundir con 404 de ruta inexistente)
        code = "sale_order_id_not_found" if sale_order_id is not None else "sale_order_not_found"
        return jsonify({
            "error": str(e),
            "code": code,
        }), 422
    except RuntimeError as e:
        return jsonify({"error": str(e)}), 502
    except xmlrpc.client.Fault as e:
        return jsonify({"error": f"Odoo: {e.faultString}"}), 502
    except OSError as e:
        return jsonify({"error": f"Red / conexión: {e}"}), 502
    except Exception as e:
        return _internal_error(e)


@app.route("/api/odoo/order-receipt-json")
def api_odoo_order_receipt_json():
    """
    Retorna data estructurada (JSON) de una nota de venta o ticket POS
    para que la web genere el recibo localmente.
    Query: nota=...
    """
    if not is_configured():
        return jsonify({"error": "Faltan variables ODOO"}), 503
        
    nota = request.args.get("nota", "").strip()
    if not nota:
        return jsonify({"error": "Indica el parámetro 'nota'"}), 400
        
    try:
        cfg = config_from_environ()
        details = order_details_for_receipt_by_name(
            cfg, nota, match_name_only=_match_name_only_from_request()
        )
        return jsonify(details)
    except Exception as e:
        return _internal_error(e, context="order-receipt-json")


@app.route("/api/odoo/accounts-receivable", methods=["POST"])
def api_odoo_accounts_receivable():
    """
    CxC por lista de documentos (name/client_order_ref) desde Odoo.
    Body JSON: { "refs": ["OVERSHARK/123", ...], "match_name_only": false }
    """
    if not is_configured():
        return jsonify({"error": "Faltan variables ODOO"}), 503
    data = request.get_json(silent=True) or {}
    refs = data.get("refs")
    if not isinstance(refs, list):
        return jsonify({"error": "refs debe ser una lista de textos"}), 400
    cleaned: list[str] = []
    for v in refs[:2000]:
        s = str(v or "").strip()
        if s:
            cleaned.append(s)
    if not cleaned:
        return jsonify({"items": {}, "count": 0})
    try:
        cfg = config_from_environ()
        items = sale_order_accounts_receivable_by_documents(
            cfg,
            cleaned,
            match_name_only=bool(data.get("match_name_only", False)),
        )
        return jsonify({"items": items, "count": len(items)})
    except xmlrpc.client.Fault as e:
        return jsonify({"error": f"Odoo: {e.faultString}"}), 502
    except OSError as e:
        return jsonify({"error": f"Red / conexión: {e}"}), 502
    except Exception as e:
        return _internal_error(e)


@app.route("/api/shalom/config")
def api_shalom_config():
    try:
        config = get_shalom_config()
        return jsonify(config)
    except Exception as e:
        return _internal_error(e, context="shalom/config")

@app.route("/api/shalom/tracking-url")
def api_shalom_tracking_url():
    guia = request.args.get("guia", "").strip()
    codigo = request.args.get("codigo", "").strip()
    url = build_tracking_url(guia=guia or None, codigo=codigo or None)
    return jsonify({"url": url, "guia": guia, "codigo": codigo})


def main():
    port = int(os.environ.get("PORT", "5000"))
    host = os.environ.get("HOST", "127.0.0.1")
    debug = os.environ.get("FLASK_DEBUG", "").lower() in ("1", "true", "yes")
    app.run(host=host, port=port, debug=debug)


if __name__ == "__main__":
    main()
