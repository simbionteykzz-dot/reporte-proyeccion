# -*- coding: utf-8 -*-
"""Punto de entrada serverless para Vercel (WSGI)."""
from __future__ import annotations

import sys
from pathlib import Path

_root = Path(__file__).resolve().parent.parent
_backend = _root / "backend"
if str(_backend) not in sys.path:
    sys.path.insert(0, str(_backend))

from web_app import app  # noqa: E402
