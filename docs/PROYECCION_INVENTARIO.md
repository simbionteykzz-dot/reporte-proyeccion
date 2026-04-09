# Proyección Inventario — Documento de presentación

## Qué es

**Proyección Inventario** es un **panel web de análisis y proyección** orientado a la gestión de inventario y ventas. Se alimenta en tiempo real de **Odoo** (ERP) mediante su API estándar **XML-RPC**, consolidando información de **stock**, **ventas** (pedidos web y, opcionalmente, punto de venta) y **reglas de negocio** definidas por familia de producto.

No sustituye a Odoo: **lee** datos y **calcula** indicadores para apoyar decisiones operativas (producción, compras, riesgo de quiebre, agotamiento).

---

## Para qué sirve (función principal)

1. **Visibilidad unificada**  
   Ofrecer una vista consolidada por compañía, familia de producto y, cuando aplica, la vista **Bravos** (plantillas de producto concretas).

2. **Proyección y riesgo**  
   Apoyar la estimación de **cómo evoluciona el inventario** frente a la demanda reciente, incluyendo métricas de **días restantes**, **proyección de fin de mes** y **clasificación de criticidad** cuando el stock se agota o está en zona de riesgo.

3. **Trazabilidad de reglas**  
   Las cantidades por orden, tickets comerciales y exclusiones de categorías están **codificadas y documentadas en el backend** (`analytics.py`), de modo que los números del panel pueden explicarse frente a negocio.

4. **Acceso controlado**  
   El acceso al panel se protege con **credenciales definidas solo en el servidor** (variables de entorno), sin exponer contraseñas en el código del cliente.

---

## Qué se espera que haga el sistema

| Expectativa | Descripción |
|-------------|-------------|
| **Conectar a Odoo** | Con las variables `ODOO_*` correctas, el sistema debe autenticarse y leer modelos acordados (productos, stock, ventas, compañías, etc.). |
| **Respetar filtros** | Fechas, compañía y pestaña Producción / Bravos deben cambiar los datos mostrados de forma coherente en KPIs, tablas y gráficos. |
| **Consistencia numérica** | Totales y desgloses (por talla, familia, matriz) deben **cuadrar** entre sí; el proyecto define criterios de QA para evitar desalineaciones. |
| **Comportamiento sin datos** | Si no hay datos o Odoo no está configurado, la interfaz debe mostrar estados claros (vacío / error) sin romper la aplicación. |
| **Despliegue web** | El panel debe poder ejecutarse en un entorno HTTPS (por ejemplo Vercel) con sesión y cookies configuradas de forma adecuada para producción. |

---

## Alcance funcional (resumen)

- **Pestaña Producción**: agregación por **familias de negocio** mapeadas desde categorías Odoo, con reglas de cantidad por orden y tickets de referencia donde aplica.
- **Pestaña Bravos**: vista centrada en **plantillas de producto** configurables (IDs por defecto o vía entorno), con control de qué plantillas suman a métricas globales.
- **Reporte de auditoría** (ruta dedicada en el panel): apoyo a revisión de datos alineado con el mismo contrato de datos.
- **Salud del sistema**: endpoint `/api/health` para comprobar configuración Odoo, archivos de entorno opcionales y estado básico del despliegue.

---

## Fuera de alcance (no objetivos)

- No modifica inventario ni pedidos en Odoo (solo lectura salvo futuras extensiones explícitas).
- No reemplaza informes contables ni fiscales oficiales.
- No garantiza por sí mismo la calidad maestra en Odoo: si los datos de origen son incorrectos, los indicadores reflejarán esa situación.

---

## Indicadores de éxito para la organización

- Uso regular del panel para **anticipar roturas de stock** y priorizar familias o líneas.
- **Menos discrepancias** entre lo que “se cree” que hay en stock y lo que muestra el panel (validación cruzada con Odoo).
- **Tiempo reducido** en armar proyecciones manuales en hojas de cálculo a partir de Odoo.

---

## Próximos pasos sugeridos (evolutivos)

- Ampliar documentación de **contrato de datos** por endpoint (campos, filtros, fórmulas) según evolucione `analytics.py`.
- Revisión periódica de **umbrales de negocio** (`BUSINESS_QTY_BY_FAMILY`, tickets, exclusiones) cuando cambien las reglas comerciales.

---

*Documento orientado a presentación ejecutiva y de producto. Detalle técnico: ver [ARQUITECTURA.md](./ARQUITECTURA.md) y [VARIABLES_ENTORNO.md](./VARIABLES_ENTORNO.md).*
