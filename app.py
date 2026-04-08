# -*- coding: utf-8 -*-
"""
Entrada WSGI para Vercel (Flask preset): debe vivir en la raíz del repo como app.py.

Normaliza PATH_INFO en el entorno serverless antes de delegar al Flask de backend/web_app.py.
"""
from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

_root = Path(__file__).resolve().parent
_backend = _root / "backend"
if str(_backend) not in sys.path:
    sys.path.insert(0, str(_backend))

from web_app import app as _flask_app  # noqa: E402


def _normalize_path(path_info: str | None) -> str:
    if not path_info or path_info == "":
        return "/"
    pi = path_info if path_info.startswith("/") else "/" + path_info
    for prefix in ("/api/index.py", "/api/index"):
        if pi == prefix or pi.startswith(prefix + "/"):
            rest = pi[len(prefix) :] or "/"
            return rest if rest.startswith("/") else "/" + rest
    return pi


def app(environ: dict[str, Any], start_response: Any):
    environ["PATH_INFO"] = _normalize_path(environ.get("PATH_INFO"))
    environ["SCRIPT_NAME"] = ""
    return _flask_app(environ, start_response)
