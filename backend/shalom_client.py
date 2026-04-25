# -*- coding: utf-8 -*-
from __future__ import annotations
from pathlib import Path

def _load_shalom_env() -> dict:
    env_path = Path(__file__).parent / "shalom.env"
    data = {}
    if not env_path.is_file():
        return data
    try:
        with open(env_path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                if "=" in line:
                    k, _, v = line.partition("=")
                    data[k.strip()] = v.strip()
    except Exception:
        pass
    return data

_SHALOM_ENV: dict | None = None

def get_shalom_env() -> dict:
    global _SHALOM_ENV
    if _SHALOM_ENV is None:
        _SHALOM_ENV = _load_shalom_env()
    return _SHALOM_ENV

def get_shalom_base_url() -> str:
    return get_shalom_env().get("SHALOM_BASE_URL", "https://pro.shalom.pe").rstrip("/")

def build_tracking_url(guia: str | None = None, codigo: str | None = None) -> str:
    base = get_shalom_base_url()
    ref = (guia or codigo or "").strip()
    if ref:
        return f"{base}/encomiendas?numero={ref}"
    return base

def get_shalom_config() -> dict:
    env = get_shalom_env()
    base = get_shalom_base_url()
    return {
        "base_url": base,
        "configured": bool(env.get("SHALOM_USERNAME")),
        "tracking_url_template": f"{base}/encomiendas?numero={{guia}}",
    }
