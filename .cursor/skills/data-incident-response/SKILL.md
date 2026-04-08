---
name: data-incident-response
description: Diagnose and resolve reporting data mismatches (total vs charts vs table), identify root cause in source fields or transformations, and produce a fix + verification report. Use when report numbers are inconsistent or regress after changes.
---

# Data Incident Response

## Goal
Resolver rápidamente incidentes de desalineación numérica en reportes.

## Trigger scenarios
- `total` no coincide con tabla o gráficos.
- Cambio reciente rompió métricas históricas.
- Filtros de fecha/mes/semana devuelven resultados inesperados.

## Incident workflow

```markdown
Data Incident Checklist
- [ ] Capture exact mismatch (expected vs actual)
- [ ] Identify affected endpoint and payload fields
- [ ] Recompute totals from raw source rows
- [ ] Compare transformation steps one by one
- [ ] Locate root cause (field, filter, fallback, rounding)
- [ ] Apply minimal fix
- [ ] Re-run consistency checks
- [ ] Publish incident summary
```

## Root-cause categories
- Campo incorrecto para cantidad (ej. versión de Odoo distinta).
- Filtro inconsistente entre backend y frontend.
- Exclusiones distintas (`Sin dato`, anulados, etc.).
- Redondeo aplicado en fase incorrecta.

## Required incident output

```markdown
## Data Incident Report
- Scope:
- Endpoint:
- Mismatch observed:
- Root cause:
- Fix applied:
- Validation:
  - total_qty:
  - sum(by_size):
  - sum(matrix):
- Residual risk:
```

## Rule
No cerrar incidente sin evidencia de consistencia numérica post-fix.
