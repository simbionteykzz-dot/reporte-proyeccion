# -*- coding: utf-8 -*-
"""Arranque local desde la raíz del repo (public/, .env)."""
from __future__ import annotations

import os
import sys
from pathlib import Path

_root = Path(__file__).resolve().parent
os.chdir(_root)
_backend = _root / "backend"
if str(_backend) not in sys.path:
    sys.path.insert(0, str(_backend))

from web_app import main  # noqa: E402

if __name__ == "__main__":
    main()
