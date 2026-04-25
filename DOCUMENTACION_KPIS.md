# KPIs — Origen de datos y lógica de cálculo

## Fuente de datos

| Panel | Tabla Supabase | Endpoint backend |
|---|---|---|
| Lima | `tb_envios_diarios_lina` | `GET /api/supabase/zazu-envios` |
| Provincia | `tb_envios_shalom`, `tb_envios_olva`, `tb_envios_marvisur` | `GET /api/supabase/provincia-envios` |

Los datos de Odoo (CxC) se obtienen en paralelo desde `POST /api/odoo/accounts-receivable` buscando por `nota_odoo` o `id_venta` contra `sale.order.name` y `pos.order.number_zazu`.

---

## KPIs de Lima

Calculados en `zazuComputeMetrics()` sobre todas las filas de `S.zazuRowsAll` (sin paginación, sobre el total cargado). El clasificador de estado es `zazuStateBucket()`.

### Clasificación de estado (`zazuStateBucket`)

Prioridad de evaluación (en orden):

1. Si el campo `reprogramado` o `motivo_reprogramado` tiene valor distinto de `false/0/no` → **Reprogramado**
2. Si `estado_pedido / estado / estado_despacho / estado_qr` contiene `anulad` o `cancel` → **Anulado**
3. Si contiene `reprogram` → **Reprogramado**
4. Si coincide con `/\bno\s+entreg/` o es exactamente `no entregado/no entregada` → **No Entregado**
5. Si contiene `entreg` → **Entregado**
6. Si contiene `curso / camino / ruta / pendiente / despacho` → **En Curso**
7. Cualquier otro valor → **En Curso** (fallback)

### Tabla de KPIs Lima

| KPI | Fórmula | Campo(s) fuente |
|---|---|---|
| **Total Notas** | `COUNT(filas)` | Todas las filas del tab activo |
| **Entregados** | Filas donde `zazuStateBucket = 'entregado'` | `estado_pedido`, `estado`, `estado_despacho`, `estado_qr` |
| **No Entregados** | Filas donde `zazuStateBucket = 'no_entregado'` | Idem — texto exacto o regex `no entregado/a` |
| **Reprogramados** | Filas donde `zazuStateBucket = 'reprogramado'` | `reprogramado`, `motivo_reprogramado`, o texto `reprogram` en estado |
| **Anulados** | Filas donde `zazuStateBucket = 'anulado'` | Texto `anulad` o `cancel` en estado |
| **Monto cobrado** | `SUM(monto_cobrado)` con fallbacks | Ver tabla de fallbacks abajo |
| **Costo servicio** | `SUM(monto_deuda)` con fallbacks | `monto_deuda`, `costo_servicio`, `costo_envio`, `shipping_cost`, `delivery_fee`, `service_cost` |
| **Cierre caja** | `Monto cobrado − Costo servicio` | Calculado |

### Fallbacks para Monto cobrado (`zazuMontoCobradoResolved`)

Prioridad:
1. `monto_cobrado` o `monto_cobrar` (directo de Supabase)
2. Suma de `yape_monto + transferencia_monto + efectivo_monto` si existen
3. `amount_paid` de Odoo (si la fila tiene CxC vinculado)
4. `amount_to_collect` de Odoo (fallback final)
5. `0` si ninguno aplica

---

## KPIs de Provincia

Calculados en `zazuComputeMetrics()` sobre todas las filas de `S.zazuProvRows`. El clasificador de estado es `zazuProvStateBucket()`, distinto al de Lima.

### Clasificación de estado (`zazuProvStateBucket`)

Prioridad de evaluación:

1. Si contiene `anulad` o `cancel` → **Anulado**
2. Si contiene `devolu` o `devuelt` → **Devolución**
3. Si contiene `retorn` → **Retorno**
4. Si coincide con `no entregado/a` → **Pendiente**
5. Si contiene `entreg` → **Entregado**
6. Cualquier otro valor → **Pendiente** (fallback)

### Tabla de KPIs Provincia

| KPI | Fórmula | Campo(s) fuente |
|---|---|---|
| **Total Envíos** | `COUNT(filas)` | Todas las filas del tab activo |
| **Entregados** | Filas donde `zazuProvStateBucket = 'entregado'` | `estado`, `estado_qr`, `estado_odoo` |
| **Pendientes** | Filas donde `zazuProvStateBucket = 'pendiente'` (incluye no entregados, en tránsito y fallbacks) | Idem |
| **Anulados** | Filas donde `zazuProvStateBucket = 'anulado'` | Texto `anulad` o `cancel` en estado |
| **Monto cobrar** | `SUM(monto_cobrar)` | `monto_cobrar` directo de Supabase |
| **Costo servicio** | `SUM(monto_deuda)` | `monto_deuda` directo de Supabase |
| **Cierre caja** | `Monto cobrar − Costo servicio` | Calculado |

> **Nota:** Los KPIs de Provincia no incluyen Reprogramados ni No Entregados como categorías separadas porque los courriers de provincia (Shalom, Olva, Marvisur) no manejan ese estado — los pedidos no entregados quedan como Pendientes o Devolución/Retorno.

---

## Diferencias clave entre Lima y Provincia

| Aspecto | Lima | Provincia |
|---|---|---|
| Tabla Supabase | `tb_envios_diarios_lina` | `tb_envios_shalom/olva/marvisur` |
| Clasificador estado | `zazuStateBucket` | `zazuProvStateBucket` |
| Estado "No entregado" | KPI propio | Agrupado en Pendientes |
| Estado "Reprogramado" | KPI propio | No aplica |
| Estado "Devolución/Retorno" | No aplica | Usados como tabs de filtro |
| Monto cobrado | Multicampo con fallbacks (yape, transferencia, efectivo, Odoo) | Solo `monto_cobrar` de Supabase |
| CxC Odoo | Lookup async via `zazuCxcByRef` con `nota_odoo / id_venta` | Embebido en `r.odoo` desde backend |

---

## Campos Supabase relevantes por tabla

| Campo | Lima (`tb_envios_diarios_lina`) | Provincia (Shalom/Olva/Marvisur) |
|---|---|---|
| Estado | `estado_pedido`, `estado`, `estado_despacho`, `estado_qr` | `estado`, `estado_qr`, `estado_odoo` |
| Referencia Odoo | `nota_venta`, `numero_nota`, `id_venta` → `nota_odoo` | `nota_venta`, `numero_nota`, `id_venta` → `nota_odoo` |
| Monto | `monto_cobrado`, `monto_cobrar`, `yape_monto`, `transferencia_monto`, `efectivo_monto` | `monto_cobrar` |
| Costo courier | `monto_deuda` | `monto_deuda` |
| Fecha | `fecha_entrega`, `fecha_programada`, `fecha`, `fecha_registro` | `fecha`, `fecha_registro` |
| Reprogramado | `reprogramado`, `motivo_reprogramado` | No existe |
