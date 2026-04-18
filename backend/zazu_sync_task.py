# -*- coding: utf-8 -*-
import os
import requests
from datetime import datetime
from typing import Any

# Intentamos cargar variables de entorno desde múltiples fuentes
try:
    from dotenv import load_dotenv
    # Cargar .env de raíz y api/.env
    load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
    load_dotenv(os.path.join(os.path.dirname(__file__), "..", "api", ".env"))
    # Cargar credenciales específicas si existen
    load_dotenv(os.path.join(os.path.dirname(__file__), "zazu_credentials.env"))
except ImportError:
    pass

from zazu_supabase import _strip, zazu_configured

# Master list for filtering Lima Metropolitana and Callao
LIMA_DISTRICTS = {
    "Lima", "Ancon", "Ate", "Barranco", "Breña", "Carabayllo", "Chaclacayo", "Chorrillos", "Cieneguilla",
    "Comas", "El Agustino", "Independencia", "Jesus Maria", "La Molina", "La Victoria", "Lince",
    "Los Olivos", "Lurigancho", "Lurin", "Magdalena del Mar", "Miraflores", "Pachacamac", "Pucusana",
    "Pueblo Libre", "Puente Piedra", "Punta Hermosa", "Punta Negra", "Rimac", "San Bartolo",
    "San Borja", "San Isidro", "San Juan de Lurigancho", "San Juan de Miraflores", "San Luis",
    "San Martin de Porres", "San Miguel", "Santa Anita", "Santa Maria del Mar", "Santa Rosa",
    "Santiago de Surco", "Surquillo", "Villa El Salvador", "Villa Maria del Triunfo",
    "Bellavista", "Callao", "Carmen de la Legua", "La Perla", "La Punta", "Ventanilla", "Mi Peru"
}

def classify_zona(distrito: str) -> str:
    """Clasifica un distrito en Lima o Provincia."""
    if not distrito or distrito == "—":
        return "Desconocido"
    # Limpieza básica para comparación
    d = distrito.strip().title()
    if d in LIMA_DISTRICTS:
        return "Lima"
    # Búsqueda parcial si no hay match exacto
    for l_dist in LIMA_DISTRICTS:
        if l_dist.lower() in d.lower():
            return "Lima"
    return "Provincia"

def extract_brand(order_ref: str) -> str:
    """Extrae la marca desde el string de orden/referencia."""
    s = (order_ref or "").lower()
    if "overshark" in s or "over" in s:
        return "Overshark"
    if "bravos" in s or "brav" in s:
        return "Bravos"
    if "box" in s:
        return "Box Prime"
    if "tino" in s:
        return "TinoStack"
    return "Otros"

def sync_zazu_data_to_supabase():
    """
    Sincroniza datos desde las tablas de Zazu (Lima y Provincia) hacia la tabla del dashboard.
    Método: API-to-API (Supabase Direct).
    """
    if not zazu_configured():
        return {"success": False, "error": "Supabase no está configurado (URL/KEY faltantes)."}

    # Credenciales de Zazu portal
    user = os.environ.get("ZAZU_WEB_USER", "").strip()
    password = os.environ.get("ZAZU_WEB_PASSWORD", "").strip()
    
    base_url = _strip("ZAZU_SUPABASE_URL").rstrip("/")
    anon_key = _strip("ZAZU_SUPABASE_ANON_KEY")

    if not user or not password:
        return {"success": False, "error": "Faltan credenciales de Zazu (ZAZU_WEB_USER/ZAZU_WEB_PASSWORD)."}

    try:
        # 1. Autenticación en Supabase Auth de Zazu
        auth_url = f"{base_url}/auth/v1/token?grant_type=password"
        auth_headers = {"apikey": anon_key, "Content-Type": "application/json"}
        auth_body = {"email": user, "password": password}
        
        auth_resp = requests.post(auth_url, json=auth_body, headers=auth_headers, timeout=20)
        if auth_resp.status_code == 400:
            return {"success": False, "error": "Credenciales de Zazu Express incorrectas."}
        auth_resp.raise_for_status()
        access_token = auth_resp.json().get("access_token")

        if not access_token:
            return {"success": False, "error": "No se pudo obtener el token de acceso de Zazu."}

        # 2. Fuentes de datos (Lima y Provincia)
        sources = [
            {"table": "tb_envios_lina", "zona_default": "Lima"},
            {"table": "tb_envios_provincia_lina", "zona_default": "Provincia"}
        ]
        
        upsert_payload = []
        sync_stats = {"Lima": 0, "Provincia": 0, "Errors": []}

        fetch_headers = {
            "apikey": anon_key,
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json"
        }

        for src in sources:
            table = src["table"]
            try:
                # Traemos los 1000 más recientes de cada tabla para asegurar completitud
                fetch_url = f"{base_url}/rest/v1/{table}?select=*&order=id.desc&limit=1000"
                resp = requests.get(fetch_url, headers=fetch_headers, timeout=30)
                
                if resp.status_code == 404:
                    # Si falla por tabla inexistente (registros antiguos), probamos con 'registros'
                    if table == "tb_envios_lina":
                        fetch_url = f"{base_url}/rest/v1/registros?select=*&order=id.desc&limit=1000"
                        resp = requests.get(fetch_url, headers=fetch_headers, timeout=30)
                
                resp.raise_for_status()
                data = resp.json()

                for row in data:
                    id_val = row.get("id")
                    if not id_val: continue
                    
                    # Normalización de campos según la fuente
                    cliente = row.get("nombre") or row.get("cliente") or row.get("nombre_cliente") or "Sin nombre"
                    estado = row.get("tipo") or row.get("tipo_pedido") or row.get("estado_pedido") or "Desconocido"
                    fecha = row.get("fecha_de_entrega") or row.get("fecha") or row.get("created_at")
                    distrito = row.get("distrito") or "—"
                    orden = row.get("numero_orden") or row.get("id") or ""
                    
                    # Decidimos la zona
                    zona = src["zona_default"]
                    if zona == "Lima":
                        # Doble check por si acaso el envío a Lima es en realidad provincia (raro pero ocurre)
                        if classify_zona(distrito) == "Provincia":
                            zona = "Provincia"

                    mapped = {
                        "id_envio": str(id_val),
                        "estado_pedido": estado,
                        "fecha": fecha,
                        "nombre_cliente": cliente,
                        "verificacion": True if "entregado" in str(estado).lower() else False,
                        "created_at": datetime.now().isoformat(),
                        "envio": {
                            "distrito": distrito,
                            "numero_orden": orden,
                            "nombre_cliente": cliente,
                            "zona": zona,
                            "marca": extract_brand(orden), # Nueva extracción de marca
                            "raw_source": table,
                            "raw_data": row
                        }
                    }
                    
                    # Flatten extras
                    for k, v in row.items():
                        clean_k = str(k).lower().replace(" ", "_")
                        if clean_k not in mapped:
                            mapped[clean_k] = v
                    
                    upsert_payload.append(mapped)
                    sync_stats[src["zona_default"]] += 1

            except Exception as e:
                sync_stats["Errors"].append(f"Error en tabla {table}: {str(e)}")

        if not upsert_payload:
            return {"success": False, "error": f"No se obtuvieron registros de ninguna fuente. Errores: {sync_stats['Errors']}"}

        # 3. Upsert masivo
        dest_url = f"{base_url}/rest/v1/tb_envios_diarios_lina"
        dest_headers = {
            "apikey": anon_key,
            "Authorization": f"Bearer {anon_key}", 
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates"
        }
        
        upsert_resp = requests.post(dest_url, json=upsert_payload, headers=dest_headers, timeout=30)
        upsert_resp.raise_for_status()

        return {
            "success": True,
            "message": f"Sincronizados: {sync_stats['Lima']} Lima, {sync_stats['Provincia']} Provincia.",
            "details": sync_stats,
            "timestamp": datetime.now().isoformat()
        }

    except Exception as e:
        return {"success": False, "error": f"Fallo crítico en sincronización: {str(e)}"}

    except Exception as e:
        return {"success": False, "error": f"Fallo en comunicación API: {str(e)}"}
