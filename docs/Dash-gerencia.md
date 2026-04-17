# Especificación: dashboard gerencial (Ventas, Contabilidad, Inventario, Logística)

Documento orientativo para diseñar un **panel ejecutivo** alimentado por **Odoo** (vía API/XML-RPC o equivalente), alineado con buenas prácticas de reporting y con el enfoque de este repositorio: **contrato de datos claro**, **filtros por compañía y periodo**, y **trazabilidad** entre KPI, tablas y gráficos.

---

## 1. Objetivo

Centralizar en una sola experiencia:

- **Ventas** (pedidos, facturación vinculada, canal tienda vs TPV si aplica).
- **Contabilidad** (resultado, flujo, cuentas clave; según módulos instalados).
- **Inventario** (existencias, valorización, rotación, riesgo de quiebre).
- **Logística** (entradas, salidas, transferencias internas).
- **Ingresos / cobros** (facturas, pagos, conciliación básica).

El documento no sustituye un análisis contable firmado; define **qué preguntas de negocio** responder y **de dónde** salen en Odoo.

---

## 2. Principios transversales (clave para que “funcione bien”)

| Principio | Qué implica |
|-----------|-------------|
| **Un periodo y una moneda por vista** | Todos los KPI del tablero deben usar el mismo `date_from` / `date_to` (o mes fiscal) y aclarar si los importes están en moneda de compañía o en moneda extranjera. |
| **Una compañía (o consolidación explícita)** | Filtrar por `company_id` o documentar reglas si se mezclan varias compañías (riesgo de doble conteo). |
| **Definición única por KPI** | Cada indicador tiene una fórmula escrita (ej. “ventas = importe de líneas facturadas con impuestos excluidos”) y no se mezcla con otra sin avisar. |
| **Estados Odoo explícitos** | Incluir en el contrato qué estados de `sale.order`, `stock.picking`, `account.move` entran (ej. solo `posted` en asientos). |
| **Performance** | Paginar o limitar filas; agregar en servidor cuando sea posible; evitar `search_read` sin límite en tablas grandes. |
| **Permisos del usuario API** | El usuario técnico debe tener lectura sobre todos los modelos usados; si no, los KPI quedarán en cero o fallarán de forma intermitente. |

---

## 3. Áreas del dashboard y KPI sugeridos

### 3.1 Ventas (comercial)

**Preguntas de negocio:** ¿Cuánto vendimos? ¿Por canal? ¿Pedidos abiertos vs facturados? ¿Devoluciones?

| KPI / indicador | Idea | Modelos Odoo típicos | Notas |
|-----------------|------|----------------------|--------|
| Ventas del periodo (importe) | Suma de bases o totales según política | `sale.order` / `sale.order.line`, o `account.move.line` si se toma lo **facturado** | Decidir: **pedido confirmado** vs **facturado** (suelen divergir). |
| Unidades vendidas | Cantidades en UoM | `sale.order.line`, `pos.order.line` | TPV a menudo en `pos.order`. |
| Nº pedidos / ticket medio | Conteo y total / pedidos | `sale.order` | Excluir cotizaciones (`draft`) si solo interesa confirmado. |
| Pedidos pendientes de entregar | Backlog operativo | `sale.order` + líneas pendientes o `stock.picking` ligados | Depende de flujo de entregas parciales. |
| Ventas por equipo / vendedor | Si se usa CRM/equipo | `sale.order` (`team_id`, `user_id`) | Requiere datos consistentes en Odoo. |
| Cancelaciones | Pedidos cancelados en el periodo | `sale.order` `state=cancel` | Fecha: `date_order` vs `write_date` (definir una). |

**Campos clave:** `date_order`, `state`, `company_id`, `partner_id`, `amount_total`, `currency_id`, líneas: `product_uom_qty`, `price_subtotal`, `qty_delivered`, `qty_invoiced`.

---

### 3.2 Contabilidad (finanzas)

**Preguntas:** ¿Resultado del periodo? ¿De dónde vienen ingresos y gastos? ¿Conciliación básica?

| KPI / indicador | Idea | Modelos típicos | Notas |
|-----------------|------|-----------------|--------|
| Ingresos / gastos por cuenta o grupo | P&L simplificado | `account.move.line` con `parent_state=posted` | Filtrar por `date` del asiento o del apunte (definir). |
| Margen bruto (si hay coste en líneas) | Ingresos − coste de ventas | `account.move.line` + plan de cuentas | Muy dependiente del **mapeo de cuentas** en la compañía. |
| IVA / impuestos liquidables | Suma por `tax_ids` o cuentas de impuesto | `account.move.line` | Requiere revisión con asesoría fiscal local. |
| Flujo de caja (aprox.) | Entradas/salidas bancarias | `account.bank.statement.line`, `account.payment` | “Aprox.” porque el flujo formal puede requerir reportes nativos de Odoo. |

**Campos clave:** `account.move`: `state`, `date`, `company_id`, `move_type`.  
`account.move.line`: `account_id`, `debit`, `credit`, `balance`, `partner_id`, `date`.

**Riesgo:** sin acuerdo sobre **plan de cuentas** y etiquetas, los KPI financieros no son comparables entre periodos.

---

### 3.3 Inventario

**Preguntas:** ¿Qué valor tenemos? ¿Qué se mueve? ¿Qué está en riesgo?

| KPI / indicador | Idea | Modelos típicos | Notas |
|-----------------|------|-----------------|--------|
| Valor de stock | Valoración actual | `stock.quant` + coste producto / capas | Método: estándar, FIFO, etc., según configuración. |
| Rotación / días de inventario | Salidas / stock medio (periodo) | `stock.move` agregado, `stock.quant` | Necesita definición de “salida” (solo `done`, solo clientes, etc.). |
| Roturas / stock bajo | Bajo umbral o días para agotar | `stock.quant`, reglas de reorder | Similar a lo ya trabajado en el panel de riesgos. |
| Ajustes de inventario | Movimientos de tipo ajuste | `stock.move` origen inventario | Filtrar por ubicación y tipo. |

**Campos clave:** `stock.quant`: `product_id`, `location_id`, `quantity`, `company_id`.  
`stock.move`: `state`, `date`, `location_id`, `location_dest_id`, `product_uom_qty`, `product_id`.

---

### 3.4 Logística: entradas, salidas, transferencias

**Preguntas:** ¿Qué entró/salió en almacén? ¿A tiempo?

| KPI / indicador | Idea | Modelos típicos | Notas |
|-----------------|------|-----------------|--------|
| Salidas completadas | Entregas a cliente | `stock.picking` `state=done`, tipo salida | Fecha: `date_done`. |
| Entradas completadas | Recepciones | `stock.picking` tipo entrada | |
| Transferencias internas | Movimiento entre ubicaciones | `stock.picking` / `stock.move` | Útil para no mezclar con venta. |
| Lead time operativo (opcional) | Diferencia entre creación y validación | `stock.picking` fechas | Requiere campos o cálculo acordado. |

**Campos clave:** `picking_type_id`, `state`, `date_done`, `origin`, `partner_id`, `sale_id` / `purchase_id` si existen.

---

### 3.5 Ingresos por cobros (caja / tesorería)

**Preguntas:** ¿Cuánto cobramos? ¿Qué queda por cobrar?

| KPI / indicador | Idea | Modelos típicos | Notas |
|-----------------|------|-----------------|--------|
| Cobros del periodo | Pagos registrados | `account.payment`, extractos bancarios | Enlazar con facturas si se quiere “cobrado vs emitido”. |
| Cuentas por cobrar (saldo) | Deuda clientes | `account.move.line` en cuentas de deudores o reporte nativo | Suele ser snapshot, no solo flujo del mes. |
| Facturación vs cobro | Comparar totales | `account.move` (facturas) vs pagos | Útil para **DSO** aproximado con definición clara. |

---

## 4. Claves técnicas y de operación (checklist)

### 4.1 Acceso y seguridad

- Usuario API con **solo lectura** donde sea posible; listado explícito de modelos: `sale.order`, `sale.order.line`, `account.move`, `account.move.line`, `stock.picking`, `stock.move`, `stock.quant`, `product.product`, `res.partner`, `pos.order` (si hay TPV), etc.
- **Multi-compañía:** mismo criterio que el panel actual (`company_id` / compañías permitidas al usuario del panel).

### 4.2 Rendimiento

- Límites por consulta (`ODOO_RPC_PAGE_SIZE`, límites por endpoint).
- Agregaciones pesadas en **batch** o jobs si el volumen crece.
- Caché con **invalidación** clara (ej. al pulsar “Actualizar”).

### 4.3 Calidad de datos (KPI “de confianza”)

- Reglas de **exclusión** documentadas (ej. productos de servicio, muestras, ajustes).
- **QA cruzado:** totales de tabla = suma de series del gráfico = pie de informe (como en las reglas del proyecto).

### 4.4 Versionado de Odoo

- Campos pueden cambiar entre versiones (ej. `sale_id` en albarán, estados de factura). Mantener una nota de **versión mínima** o pruebas de humo tras actualizar Odoo.

---

## 5. Distribución sugerida en pantalla (layout gerencial)

Propuesta de **jerarquía visual** (de arriba abajo o en cuadrícula tipo *executive dashboard*):

1. **Barra global:** selector de **compañía**, **periodo** (mes / rango), **moneda**, botón **Actualizar**, indicador de **última generación** y estado de **calidad de datos** (OK / advertencias).

2. **Fila 1 — Resumen financiero y ventas (KPIs grandes):**  
   Ventas del periodo · Margen o resultado (si aplica) · Cobros o facturación · Stock valorizado (opcional).

3. **Fila 2 — Dos columnas:**  
   - **Izquierda:** Ventas en el tiempo (serie) o por categoría.  
   - **Derecha:** Top clientes o top productos.

4. **Fila 3 — Inventario y logística:**  
   Rotación / días de cobertura · Salidas completadas vs objetivo (si existe) · Alertas de stock (tabla corta).

5. **Fila 4 — Detalle y descarga:**  
   Tablas con **paginación** y export CSV/XLSX por bloque (ventas, contabilidad resumida, movimientos de stock).

6. **Pie de página / panel lateral:**  
   Definiciones legales cortas (“los importes contables son informativos”, “TPV puede estar en otro bloque”, etc.).

**Principio UX:** un **máximo de 6–8 KPIs** visibles sin scroll en desktop; el resto en pestañas o secciones plegables.

---

## 6. Entregables mínimos antes de programar

| Entregable | Contenido |
|------------|-----------|
| **Matriz de KPI** | Nombre, fórmula, fuente (modelo + campos), filtros, frecuencia de actualización. |
| **Contrato JSON por bloque** | Ej. `GET /api/manager/sales-summary` con `meta`, `kpis`, `series`, `tables`. |
| **Lista de exclusiones** | Productos, ubicaciones, tipos de pedido, estados fuera de alcance. |
| **Pruebas de consistencia** | Ej. suma líneas factura = total cabecera; stock no negativo salvo reglas explícitas. |

---

## 7. Relación con este repositorio

Hoy el proyecto ya consume datos reales de Odoo para **proyección de inventario**, **ventas/POS agregadas**, **riesgos de stock** y **pedidos/entregas** en la sección añadida. Un dashboard gerencial ampliado debería:

- **Reutilizar** el mismo patrón de **filtros** (`date_from`, `date_to`, `company_id`).
- **Añadir** endpoints o un **orquestador** que agrupe varias lecturas sin duplicar lógica de negocio entre backend y frontend.
- **Documentar** cada nuevo KPI en un skill/contrato tipo `odoo-report-contract` del proyecto.

---

## 8. Próximos pasos recomendados

1. Priorizar **2–3 áreas** para una primera versión (ej. Ventas + Inventario + Logística).  
2. Validar con **finanzas** el origen de “ingresos” (pedido vs factura vs cobro).  
3. Fijar **versión de Odoo** y lista de módulos instalados (`sale`, `account`, `stock`, `point_of_sale`, etc.).  
4. Prototipo de **wireframe** + contrato JSON antes de implementar pantallas nuevas.

---

