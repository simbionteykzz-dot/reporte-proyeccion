# -*- coding: utf-8 -*-
"""
Entrada Vercel: el preset Flask exige una instancia `Flask` llamada `app` en este módulo.
Un callable WSGI suelto (función `app`) no se enlaza bien y devuelve 404 en todas las rutas.
"""
from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

_root = Path(__file__).resolve().parent
_backend = _root / "backend"
if str(_backend) not in sys.path:
    sys.path.insert(0, str(_backend))

from web_app import app as flask_application  # noqa: E402


def _normalize_path(path_info: str | None) -> str:
    if not path_info or path_info == "":
        return "/"
    pi = path_info if path_info.startswith("/") else "/" + path_info
    for prefix in ("/api/index.py", "/api/index"):
        if pi == prefix or pi.startswith(prefix + "/"):
            rest = pi[len(prefix) :] or "/"
            return rest if rest.startswith("/") else "/" + rest
    return pi


class _VercelPathFix:
    """Ajusta PATH_INFO antes del enrutado de Flask (runtimes serverless)."""

    def __init__(self, wsgi_app: Any) -> None:
        self.wsgi_app = wsgi_app

    def __call__(self, environ: dict[str, Any], start_response: Any):
        environ["PATH_INFO"] = _normalize_path(environ.get("PATH_INFO"))
        environ["SCRIPT_NAME"] = ""
        return self.wsgi_app(environ, start_response)


flask_application.wsgi_app = _VercelPathFix(flask_application.wsgi_app)

# Instancia Flask — lo que Vercel enlaza al desplegar
app = flask_application
