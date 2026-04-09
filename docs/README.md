# Documentación — Proyección Inventario

Material de referencia y presentación del panel **Proyección Inventario** conectado a Odoo.

| Documento | Contenido |
|-----------|-------------|
| [**Estructura del repositorio**](./ESTRUCTURA.md) | Árbol de carpetas, qué va en cada parte, archivos ignorados y cambios recientes. **Empezar aquí** para orientarse. |
| [Proyección Inventario — visión general](./PROYECCION_INVENTARIO.md) | Qué es el proyecto, para qué sirve y qué se espera que haga (listo para presentar). |
| [Interfaz por segmentos](./UI_SEGMENTOS.md) | Cada zona de la página (sidebar, KPIs, pestañas, insights, alertas, login, auditoría). |
| [Arquitectura y stack](./ARQUITECTURA.md) | Flujo Odoo ↔ backend ↔ navegador y despliegue. |
| [Variables de entorno](./VARIABLES_ENTORNO.md) | Credenciales Odoo, panel y opciones de sesión. |

### Carpeta `reference/`

En [docs/reference/](./reference/) hay especificaciones y notas de diseño (**backend-spec**, **design-spec**, **DASHBOARD_V2_README**) conservadas como referencia; pueden estar parcialmente desactualizadas frente al código actual.

La raíz del repositorio incluye `AGENTS.md` (flujo de trabajo para desarrollo) y `.env.example` (plantilla de configuración local).
