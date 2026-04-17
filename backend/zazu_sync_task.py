# -*- coding: utf-8 -*-
import os
import requests
from bs4 import BeautifulSoup
from datetime import datetime
from zazu_supabase import _strip, zazu_configured

def sync_zazu_data_to_supabase():
    """
    Sincroniza datos desde la web de Zazu Express hacia Supabase.
    Navega por las rutas de Lima y Provincia para capturar los envíos del día.
    """
    if not zazu_configured():
        return {"success": False, "error": "Supabase no está configurado."}

    user = os.environ.get("ZAZU_WEB_USER", "").strip()
    password = os.environ.get("ZAZU_WEB_PASSWORD", "").strip()
    base_url = os.environ.get("ZAZU_WEB_URL", "https://zazu.com.pe").strip().rstrip('/')

    if not user or not password:
        return {"success": False, "error": "Faltan credenciales de Zazu (ZAZU_WEB_USER/PASS)."}

    urls = [
        f"{base_url}/lima/envios-diarios",
        f"{base_url}/provincia",
        f"{base_url}/provincia/courier/shalom",
        f"{base_url}/provincia/courier/olva",
        f"{base_url}/provincia/courier/marvisur"
    ]

    session = requests.Session()
    
    # 1. Intento de Login (Asumiendo patrón estándar de WP o similar si es portal web)
    try:
        # Nota: Aquí asumo campos típicos. Si fallan, el usuario deberá indicar los campos reales.
        login_url = f"{base_url}/login" 
        login_data = {"user": user, "pass": password, "submit": "login"} 
        
        # Primero una petición GET para cookies
        session.get(base_url, timeout=15)
        
        # POST Login
        res = session.post(login_url, data=login_data, timeout=15)
        if res.status_code != 200:
            # Si no hay un endpoint de login claro, intentamos acceder directamente 
            # (algunos portales usan Auth básica o cookies previas)
            pass
    except Exception as e:
        print(f"Error en intento de login: {e}")

    all_scraped_data = []

    # 2. Scraping de URLs
    for url in urls:
        try:
            resp = session.get(url, timeout=20)
            if resp.status_code != 200:
                continue
            
            soup = BeautifulSoup(resp.text, 'html.parser')
            # Buscamos tablas de datos. Zazu suele usar tablas con clases como 'table' o IDs específicos.
            tables = soup.find_all('table')
            
            for table in tables:
                rows = table.find_all('tr')
                if not rows: continue
                
                # Identificar cabeceras
                headers = [th.get_text().strip().lower() for th in rows[0].find_all(['th', 'td'])]
                
                # Parsear filas
                for row in rows[1:]:
                    cells = row.find_all('td')
                    if len(cells) < 3: continue
                    
                    row_data = {}
                    for i, cell in enumerate(cells):
                        if i < len(headers):
                            row_data[headers[i]] = cell.get_text().strip()
                    
                    if row_data:
                        # Limpieza y mapeo básico
                        mapped = map_zazu_row_to_supabase(row_data)
                        if mapped:
                            all_scraped_data.append(mapped)
                            
        except Exception as e:
            print(f"Error procesando {url}: {e}")

    if not all_scraped_data:
        return {"success": False, "error": "No se encontraron datos nuevos en las URLs de Zazu. Verifique credenciales."}

    # 3. Upsert a Supabase
    try:
        count = upsert_to_supabase(all_scraped_data)
        return {
            "success": True,
            "message": f"Sincronizados {count} registros con éxito.",
            "timestamp": datetime.now().isoformat()
        }
    except Exception as e:
        return {"success": False, "error": f"Error al guardar en Supabase: {e}"}

def map_zazu_row_to_supabase(raw):
    """Convierte una fila scrapeada al formato tb_envios_diarios_lina."""
    # Heurística para mapear nombres de columnas scrapeadas a la BD
    id_envio = raw.get('id') or raw.get('id envio') or raw.get('guia') or raw.get('código')
    if not id_envio: return None
    
    estado = raw.get('estado') or raw.get('estado pedido') or raw.get('situacion') or 'Desconocido'
    fecha = raw.get('fecha') or raw.get('fecha entrega') or datetime.now().strftime('%Y-%m-%d')
    cliente = raw.get('cliente') or raw.get('destinatario') or raw.get('nombre') or 'Sin nombre'
    distrito = raw.get('distrito') or raw.get('ciudad') or raw.get('zona') or '—'
    orden = raw.get('orden') or raw.get('nro orden') or raw.get('pedido') or ''

    # Combinamos todos los campos originales en la raíz para que aparezcan en el dashboard
    # Pero mantenemos la estructura 'envio' para compatibilidad con la UI actual
    result = {
        "id_envio": id_envio,
        "estado_pedido": estado,
        "fecha": fecha,
        "nombre_cliente": cliente,
        "verificacion": True if "entregado" in estado.lower() else False,
        "created_at": datetime.now().isoformat(),
        "envio": {
            "distrito": distrito,
            "numero_orden": orden,
            "nombre_cliente": cliente,
            "raw_data": raw
        }
    }
    
    # Añadimos el resto de campos de 'raw' a la raíz para que el dashboard los autodetecte
    for k, v in raw.items():
        # Evitamos sobreescribir campos clave ya mapeados
        clean_k = k.replace(" ", "_").replace(".", "").lower()
        if clean_k not in result and clean_k not in ["envio", "motorizado"]:
            result[clean_k] = v
            
    return result

def upsert_to_supabase(data):
    """Realiza el UPSERT en Supabase tb_envios_diarios_lina."""
    base = _strip("ZAZU_SUPABASE_URL").rstrip("/")
    key = _strip("ZAZU_SUPABASE_ANON_KEY")
    url = f"{base}/rest/v1/tb_envios_diarios_lina"
    
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates"
    }
    
    resp = requests.post(url, json=data, headers=headers, timeout=30)
    resp.raise_for_status()
    return len(data)
