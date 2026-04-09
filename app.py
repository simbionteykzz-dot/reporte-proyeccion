# -*- coding: utf-8 -*-
"""
Entrada Vercel (raiz del repo): instancia Flask `app` para el preset Python/Flask.
"""
from __future__ import annotations

import sys
from pathlib import Path

_backend = Path(__file__).resolve().parent / "backend"
if str(_backend) not in sys.path:
    sys.path.insert(0, str(_backend))

from vercel_flask_entry import app as _app  # noqa: E402

app = _app
