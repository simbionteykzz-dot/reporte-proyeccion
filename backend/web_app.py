# -*- coding: utf-8 -*-
from __future__ import annotations

import hmac
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
    generate_dashboard_payload,
    get_companies_for_dashboard_user,
)

# Raiz del repo (padre de /backend): public/, assets/, .env
REPO_ROOT = Path(__file__).resolve().parent.parent
PUBLIC_DIR = REPO_ROOT / "public"
ASSETS_DIR = REPO_ROOT / "assets"

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


def _auth_configured() -> bool:
    """Si hay DASHBOARD_PASSWORD en entorno, el panel exige login."""
    return bool(os.environ.get("DASHBOARD_PASSWORD", "").strip())


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


@app.route("/")
def index():
    resp = send_from_directory(str(PUBLIC_DIR), "dashboard.html")
    resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    return resp


@app.route("/auditoria")
def auditoria():
    resp = send_from_directory(str(PUBLIC_DIR), "reporte_auditoria.html")
    resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    return resp


# ── API auth (credenciales solo en variables de entorno; nunca en el cliente) ──

@app.route("/api/auth/login", methods=["POST"])
def api_auth_login():
    if not _auth_configured():
        return jsonify({"ok": True, "auth_disabled": True})
    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""
    expected_email = (os.environ.get("DASHBOARD_LOGIN_EMAIL") or "").strip().lower()
    expected_password = os.environ.get("DASHBOARD_PASSWORD") or ""
    if not expected_email:
        return jsonify({"error": "Servidor sin DASHBOARD_LOGIN_EMAIL configurado"}), 503
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
    return jsonify({
        "ok": True,
        "odoo_configured": is_configured(),
        "missing_keys": missing_config_keys(),
        "python_dotenv_installed": dotenv_package_available(),
        "dotenv_files": dotenv_file_status(),
        "time": datetime.now().isoformat(timespec="seconds"),
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


def main():
    port = int(os.environ.get("PORT", "5000"))
    host = os.environ.get("HOST", "127.0.0.1")
    debug = os.environ.get("FLASK_DEBUG", "").lower() in ("1", "true", "yes")
    app.run(host=host, port=port, debug=debug)


if __name__ == "__main__":
    main()
