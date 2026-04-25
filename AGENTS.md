# AGENTS Workflow

Guía operativa para desarrollar este proyecto de reportes Odoo con calidad y escalabilidad.

## Flujo oficial por tarea

1. **Plan**

- Definir alcance y contrato de datos.
- Confirmar fuente Odoo, filtros y métricas.

1. **Implementación**

- Hacer cambios mínimos y modulares.
- Evitar duplicar lógica de negocio entre capas.

1. **QA**

- Validar consistencia:
  - `total_qty == sum(by_size.qty)`
  - `sum(by_size.qty) == sum(matrix_rows.by_size[*])`
- Probar filtros principales (año, meses, semanas).

1. **Cierre**

- Resumen breve de causa/solución.
- Riesgos residuales y próximos pasos.

## Agentes recomendados

- `explore`: mapear impacto en código antes de cambiar.
- `generalPurpose`: implementar cambios acotados.
- `shell`: ejecutar pruebas, arranque y validaciones.
- `ui-ux-designer`: evaluación de usabilidad, jerarquía visual y consistencia de interfaz.
- `frontend-developer`: implementación de rediseño de UI cuando la tarea es principalmente frontend.

## Flujo UI UX + Design

1. `explore` para ubicar vistas, endpoints y componentes impactados.
2. `ui-ux-designer` para proponer estructura visual y mejoras de UX.
3. `frontend-developer` o `generalPurpose` para implementar.
4. `shell` para correr servidor, pruebas y validación final.

## Skills del proyecto

- `odoo-report-contract`: define contrato de reporte antes de codificar.
- `report-qa-matrix`: checklist de QA para consistencia numérica.
- `data-incident-response`: manejo de incidentes de desalineación de datos.
- `weekly-maintenance-routine`: higiene semanal del proyecto.
- `ui-ux-design-delivery`: flujo de rediseño de paneles y validación visual/funcional.

## Skills migradas desde `.claude`

- `canvas-design`
- `mobile-design`
- `react-best-practices`
- `react-ui-patterns`
- `senior-architect`
- `senior-backend`
- `senior-frontend`
- `senior-fullstack`
- `senior-prompt-engineer`
- `skill-creator`
- `ui-ux-pro-max`
- `webapp-testing`

Ver inventario y estado de migración en:

- `.cursor/skills/MIGRATION_CLAUDE_TO_CURSOR.md`

## Playbooks de agentes migrados

Se copiaron guías de agentes a:

- `.cursor/agents-migrated`

Estas guías se usan como referencia local para orquestar los subagentes nativos equivalentes.

## Skills instaladas de diseño (externas)

- Figma: `figma-implement-design`, `figma-generate-design`, `figma-use`.
- UX/UI: usar skills de auditoría y diseño visual cuando la tarea sea de interfaz.

## Criterio de terminado

No se considera terminado un cambio si falta:

- contrato de datos claro,
- validación de consistencia,
- manejo de error útil para usuario.