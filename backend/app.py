# -*- coding: utf-8 -*-
"""
Entrada Vercel cuando el Root Directory del proyecto es la carpeta `backend/`.
Vercel busca app.py / index.py / server.py; sin este archivo solo existe web_app.py y el panel puede dar 404.
Configuracion recomendada: Root Directory = raiz del repositorio (donde esta public/ y vercel.json).
"""
from vercel_flask_entry import app
