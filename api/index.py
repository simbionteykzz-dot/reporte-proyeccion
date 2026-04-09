# -*- coding: utf-8 -*-
"""
Entrada serverless que Vercel enlaza de forma fiable con rewrites (ver vercel.json).
La raiz app.py a veces no recibe el trafico en produccion; este modulo es el handler principal.
"""
from __future__ import annotations

import sys
from pathlib import Path

_root = Path(__file__).resolve().parent.parent
_backend = _root / "backend"
if str(_backend) not in sys.path:
    sys.path.insert(0, str(_backend))

from vercel_flask_entry import app  # noqa: E402
