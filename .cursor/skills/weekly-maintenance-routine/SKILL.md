---
name: weekly-maintenance-routine
description: Execute a weekly maintenance routine for reporting projects: update rules, prune drift, capture recurring failures, and keep contracts and QA checklists aligned with code. Use for weekly project hygiene and long-term scalability.
---

# Weekly Maintenance Routine

## Objective
Mantener el proyecto estable y escalable sin deuda silenciosa.

## Weekly workflow (30-45 min)

### Monday: context alignment
- Revisar cambios de negocio (KPIs, filtros, familias).
- Actualizar contratos de reporte si hubo cambios.

### Wednesday: failure-to-rule loop
- Tomar 1-3 errores reales de la semana.
- Convertir cada error recurrente en:
  - una regla `.cursor/rules`, o
  - un bloque breve en skill relevante.

### Friday: quality hygiene
- Confirmar que reglas aún aplican al código actual.
- Eliminar instrucciones obsoletas.
- Verificar que checklist QA sigue vigente.

## Monthly check
- Revisar skills duplicados.
- Consolidar nomenclatura y términos de negocio.
- Ajustar reglas de “done criteria”.

## Output template

```markdown
## Weekly Maintenance Summary
- Rules updated:
- Skills updated:
- Recurring failures captured:
- Deprecated guidance removed:
- Risks for next week:
```
