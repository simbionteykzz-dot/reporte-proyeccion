# -*- coding: utf-8 -*-
from __future__ import annotations

import hmac
import json
import os
import xmlrpc.client
from datetime import datetime, timedelta
from pathlib import Path

from flask import Flask, jsonify, redirect, request, send_from_directory, session
from flask_cors import CORS

from odoo_connector import (
    dotenv_file_status,
    dotenv_package_available,
    is_configured,
    missing_config_keys,
)

from analytics import (
    company_id_allowed,
    generate_consolidado_ingresos_payload,
    generate_dashboard_payload,
    generate_inventory_risks_payload,
    get_companies_for_dashboard_user,
)

# Raiz del repo (padre de /backend): public/, .env
REPO_ROOT = Path(__file__).resolve().parent.parent
PUBLIC_DIR = REPO_ROOT / "public"
# Un solo origen de estaticos con public/ (local + Vercel CDN)
ASSETS_DIR = REPO_ROOT / "public" / "assets"

# Cargar .env antes de leer FLASK_SECRET_KEY / credenciales del panel
missing_config_keys()

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
    if path == "/api/health":
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
        },
    })


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


def main():
    port = int(os.environ.get("PORT", "5000"))
    host = os.environ.get("HOST", "127.0.0.1")
    debug = os.environ.get("FLASK_DEBUG", "").lower() in ("1", "true", "yes")
    app.run(host=host, port=port, debug=debug)


if __name__ == "__main__":
    main()
