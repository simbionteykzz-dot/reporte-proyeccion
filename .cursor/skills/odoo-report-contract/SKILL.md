---
name: odoo-report-contract
description: Define and validate Odoo reporting data contracts, including source models, fields, filters, metric formulas, exclusions, and stable API output shape. Use when creating or modifying report endpoints, KPI calculations, or filter behavior.
---

# Odoo Report Contract

## Purpose
Establecer un contrato de datos claro antes de implementar o cambiar reportes.

## Use when
- Se crea o modifica un endpoint de reportes.
- Cambian reglas de negocio de métricas.
- Hay desalineación entre tabla y gráficos.

## Required contract template

Completar este bloque antes de codificar:

```markdown
## Report Contract
- Source models:
- Source fields:
- Filters accepted:
- Effective date range rule:
- Exclusions:
- Metrics:
  - total_qty =
  - by_size =
  - by_color =
- Response shape:
  - by_size[]
  - by_color[]
  - matrix_rows[]
  - size_order[]
  - total_qty
  - unknown_size_qty
```

## Implementation guardrails
- Usar una sola fuente de verdad para cálculos.
- Evitar recalcular diferente en frontend.
- Si un campo no existe en una versión de Odoo, aplicar fallback explícito.

## Validation
- Verificar:
  - `total_qty == sum(by_size.qty)`
  - `sum(by_size.qty) == sum(matrix_rows.by_size[*])`
- Si no cumple, no cerrar tarea.
