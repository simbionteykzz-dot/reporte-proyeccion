# -*- coding: utf-8 -*-
import os
import requests
from datetime import datetime
from zazu_supabase import _strip, zazu_configured

def sync_zazu_data_to_supabase():
    """
    Sincroniza datos desde la tabla interna de Zazu (registros) hacia la tabla del dashboard.
    Método: API-to-API (Supabase Direct).
    """
    if not zazu_configured():
        return {"success": False, "error": "Supabase no está configurado."}

    # Credenciales de Zazu portal (proporcionadas por el usuario)
    user = os.environ.get("ZAZU_WEB_USER", "").strip()
    password = os.environ.get("ZAZU_WEB_PASSWORD", "").strip()
    
    # Supabase config (compartida)
    base_url = _strip("ZAZU_SUPABASE_URL").rstrip("/")
    anon_key = _strip("ZAZU_SUPABASE_ANON_KEY")

    if not user or not password:
        return {"success": False, "error": "Faltan credenciales de Zazu (ZAZU_WEB_USER/PASS) en Vercel."}

    try:
        # 1. Autenticación en Supabase Auth de Zazu
        auth_url = f"{base_url}/auth/v1/token?grant_type=password"
        auth_headers = {"apikey": anon_key, "Content-Type": "application/json"}
        auth_body = {"email": user, "password": password}
        
        auth_resp = requests.post(auth_url, json=auth_body, headers=auth_headers, timeout=20)
        auth_resp.raise_for_status()
        auth_data = auth_resp.json()
        access_token = auth_data.get("access_token")

        if not access_token:
            return {"success": False, "error": "No se pudo obtener el token de acceso de Zazu."}

        # 2. Fetch de datos desde la tabla 'registros' (Zazu Source)
        # Traemos registros del día de hoy (o recientes)
        # Si queremos todos, quitamos el filtro de fecha
        fetch_url = f"{base_url}/rest/v1/registros?select=*"
        fetch_headers = {
            "apikey": anon_key,
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json"
        }
        
        # Opcional: filtrar por fecha_entrega >= hoy - 7 días para no saturar
        # fetch_url += f"&fecha_entrega=gte.{datetime.now().strftime('%Y-%m-%d')}"

        fetch_resp = requests.get(fetch_url, headers=fetch_headers, timeout=30)
        fetch_resp.raise_for_status()
        raw_data = fetch_resp.json()

        if not raw_data:
            return {"success": True, "message": "No hay datos nuevos en el portal de Zazu.", "count": 0}

        # 3. Mapeo y Preparación para Upsert en 'tb_envios_diarios_lina' (Nuestro Dashboard)
        upsert_payload = []
        for row in raw_data:
            # Mapeamos campos de Zazu (registros) -> Dashboard (tb_envios_diarios_lina)
            id_val = row.get("id")
            if not id_val: continue
            
            # Heurística de mapeo basada en la estructura identificada
            cliente = row.get("cliente") or row.get("nombre_cliente") or "Sin nombre"
            estado = row.get("estado") or row.get("estado_pedido") or "Desconocido"
            fecha = row.get("fecha_entrega") or row.get("created_at")
            distrito = row.get("distrito") or "—"
            orden = row.get("numero_orden") or row.get("nro_orden") or ""

            mapped = {
                "id_envio": str(id_val),
                "estado_pedido": estado,
                "fecha": fecha,
                "nombre_cliente": cliente,
                "verificacion": True if "entregado" in estado.lower() else False,
                "created_at": datetime.now().isoformat(),
                "envio": {
                    "distrito": distrito,
                    "numero_orden": orden,
                    "nombre_cliente": cliente,
                    "raw_scraped": row # Guardamos todo el objeto por si acaso
                }
            }
            
            # Flatten extra fields como pidió el usuario ("todos los campos")
            for k, v in row.items():
                clean_k = k.lower().replace(" ", "_").replace(".", "")
                if clean_k not in mapped and clean_k not in ["envio", "created_at"]:
                    mapped[clean_k] = v
            
            upsert_payload.append(mapped)

        # 4. Upsert final en nuestra tabla
        dest_url = f"{base_url}/rest/v1/tb_envios_diarios_lina"
        dest_headers = {
            "apikey": anon_key,
            "Authorization": f"Bearer {anon_key}", # Usamos anon key para el destino
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates"
        }
        
        upsert_resp = requests.post(dest_url, json=upsert_payload, headers=dest_headers, timeout=30)
        upsert_resp.raise_for_status()

        return {
            "success": True,
            "message": f"Sincronizados {len(upsert_payload)} registros desde Zazu Core.",
            "count": len(upsert_payload),
            "timestamp": datetime.now().isoformat()
        }

    except Exception as e:
        return {"success": False, "error": f"Fallo en comunicación API: {str(e)}"}
