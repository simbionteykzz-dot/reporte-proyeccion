# -*- coding: utf-8 -*-
from __future__ import annotations

import hmac
import json
import os
import xmlrpc.client
from datetime import datetime, timedelta
from pathlib import Path

from flask import Flask, Response, jsonify, redirect, request, send_from_directory, session
from flask_cors import CORS

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
app.secret_key = os.environ.get("FLASK_SECRET_KEY", "").strip() or "dev-cambiar-FLASK_SECRET_KEY"
app.config["PERMANENT_SESSION_LIFETIME"] = timedelta(days=7)
app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
if os.environ.get("SESSION_COOKIE_SECURE", "").strip().lower() in ("1", "true", "yes"):
    app.config["SESSION_COOKIE_SECURE"] = True

CORS(app, supports_credentials=True)


def _env_strip(name: str) -> str:
    """Evita fallos por espacios o saltos al pegar variables en Vercel."""
    return (os.environ.get(name) or "").strip()


def _dashboard_user_pairs() -> list[tuple[str, str]]:
    """
    Usuarios del panel: (email_lower, password).
    Prioridad 1: DASHBOARD_USERS = JSON [{"email":"...","password":"..."}, ...]
    Prioridad 2: DASHBOARD_LOGIN_EMAIL + DASHBOARD_PASSWORD (un solo usuario, compatible con despliegues actuales).
    """
    raw = _env_strip("DASHBOARD_USERS")
    if raw:
        try:
            data = json.loads(raw)
            if isinstance(data, list):
                out: list[tuple[str, str]] = []
                for item in data:
                    if not isinstance(item, dict):
                        continue
                    em = (item.get("email") or "").strip().lower()
                    pw = (item.get("password") or "").strip()
                    if em and pw:
                        out.append((em, pw))
                if out:
                    return out
        except (json.JSONDecodeError, TypeError, ValueError):
            pass
    em = _env_strip("DASHBOARD_LOGIN_EMAIL").lower()
    pw = _env_strip("DASHBOARD_PASSWORD")
    if em and pw:
        return [(em, pw)]
    return []


def _auth_configured() -> bool:
    """Si hay al menos un usuario de panel definido, se exige login."""
    return len(_dashboard_user_pairs()) > 0


def _dashboard_auth_env_ok() -> bool:
    """True si hay usuarios configurados (sin revelar valores)."""
    return len(_dashboard_user_pairs()) > 0


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
    Si ODOO_PANEL_DIAGNOSTIC_KEY está definido, permite GET a lookup/PDF con ?diag_key=...
    sin cookie de panel (solo para diagnóstico; no uses una clave débil en producción pública).
    """
    secret = _env_strip("ODOO_PANEL_DIAGNOSTIC_KEY")
    if not secret or request.method != "GET":
        return False
    path = request.path or ""
    if path not in ("/api/odoo/sale-order-lookup", "/api/odoo/nota-venta-pdf"):
        return False
    given = request.args.get("diag_key", "").strip()
    if len(given) != len(secret):
        return False
    try:
        return hmac.compare_digest(given.encode("utf-8"), secret.encode("utf-8"))
    except (ValueError, TypeError):
        return False


def _password_ok(given: str, expected: str) -> bool:
    if not expected:
        return False
    try:
        return hmac.compare_digest(
            given.encode("utf-8"),
            expected.encode("utf-8"),
        )
    except (ValueError, TypeError):
        return False


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


@app.route("/auditoria")
def auditoria():
    r = redirect("/reporte_auditoria.html", code=302)
    r.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    return r


@app.route("/dashboard.html")
def dashboard_html_page():
    """Local: sirve desde public/. En Vercel suele atenderlo el CDN antes que Flask."""
    resp = send_from_directory(str(PUBLIC_DIR), "dashboard.html")
    resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    return resp


@app.route("/reporte_auditoria.html")
def reporte_auditoria_html_page():
    resp = send_from_directory(str(PUBLIC_DIR), "reporte_auditoria.html")
    resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    return resp


# ── API auth (credenciales solo en variables de entorno; nunca en el cliente) ──

@app.route("/api/auth/login", methods=["POST"])
def api_auth_login():
    pairs = _dashboard_user_pairs()
    if not pairs:
        return jsonify({"ok": True, "auth_disabled": True})
    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""
    for expected_email, expected_password in pairs:
        if email == expected_email and _password_ok(password, expected_password):
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
    dash_html = PUBLIC_DIR / "dashboard.html"
    login_html = PUBLIC_DIR / "login.html"
    supabase_status = supabase_health_payload()
    return jsonify({
        "ok": True,
        "odoo_configured": is_configured(),
        "missing_keys": missing_config_keys(),
        "python_dotenv_installed": dotenv_package_available(),
        "dotenv_files": dotenv_file_status(),
        "time": datetime.now().isoformat(timespec="seconds"),
        "deployment": {
            "public_dir_exists": PUBLIC_DIR.is_dir(),
            "dashboard_html_on_disk": dash_html.is_file(),
            "login_html_on_disk": login_html.is_file(),
            "dashboard_auth_env_ok": _dashboard_auth_env_ok(),
            "dashboard_users_count": len(_dashboard_user_pairs()),
            "flask_secret_key_set": bool(_env_strip("FLASK_SECRET_KEY")),
            "supabase_configured": supabase_status["configured"],
        },
    })


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
        return jsonify({"error": f"Error interno: {e}"}), 500


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
        return jsonify({"error": f"Error interno: {e}"}), 500


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
                    # Si falla Odoo, no romper el listado principal de provincia.
                    pass
        resp = jsonify(payload)
        resp.headers["Cache-Control"] = "no-store"
        return resp
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except RuntimeError as e:
        return jsonify({"error": str(e)}), 502
    except Exception as e:
        return jsonify({"error": f"Error interno: {e}"}), 500



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
        return jsonify({"error": f"Error interno: {e}"}), 500


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
        return jsonify({"error": f"Error interno: {e}"}), 500


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
        if company_id is not None:
            ctx = get_companies_for_dashboard_user()
            if not company_id_allowed(company_id, ctx["companies"]):
                return jsonify({"error": "company_id no permitido para este usuario"}), 403
        payload = generate_dashboard_payload(
            date_from,
            date_to,
            company_id=company_id,
            bravos_tab=_request_bravos_tab(),
        )
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
        return jsonify({"error": f"Error interno: {e}"}), 500


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
        return jsonify({"error": f"Error interno: {e}"}), 500


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
        return jsonify({"error": f"Error interno: {e}"}), 500


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
        return jsonify({"error": f"Error interno: {e}"}), 500


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
        return jsonify({"error": f"Error interno: {e}"}), 500


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
        return jsonify({"error": str(e)}), 500


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
        return jsonify({"error": f"Error interno: {e}"}), 500


@app.route("/api/shalom/config")
def api_shalom_config():
    try:
        config = get_shalom_config()
        return jsonify(config)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

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
