---
name: report-qa-matrix
description: Run a strict QA matrix for report correctness across API, table, and charts. Use when validating reporting changes, KPI fixes, filter logic, and data consistency before completing a task.
---

# Report QA Matrix

## Goal
Validar que cifras y visualizaciones coincidan al 100%.

## QA checklist

```markdown
QA Matrix
- [ ] API returns expected schema
- [ ] total_qty equals sum(by_size.qty)
- [ ] table total equals sum(matrix rows)
- [ ] chart totals equal table totals
- [ ] unknown_size_qty handled explicitly
- [ ] empty-state works (no crashes)
- [ ] invalid filter returns readable error
```

## Test scenarios
- Caso A: año completo, familia principal.
- Caso B: subset de meses.
- Caso C: subset de semanas.
- Caso D: combinación mes + semana.

## Output format

```markdown
## QA Result
- Scenario A: PASS/FAIL
- Scenario B: PASS/FAIL
- Scenario C: PASS/FAIL
- Scenario D: PASS/FAIL
- Consistency check: PASS/FAIL
- Notes:
```

## Rule
Si una sola validación crítica falla, el cambio no se considera terminado.
