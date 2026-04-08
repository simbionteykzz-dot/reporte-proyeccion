---
name: ui-ux-design-delivery
description: Deliver dashboard UI/UX changes from visual references, keeping layout, hierarchy, and states consistent while preserving data-contract accuracy. Use when redesigning panels, tables, filters, charts, or integrating Figma references.
---

# UI UX Design Delivery

## Purpose
Implementar rediseños de paneles con calidad visual y coherencia funcional.

## Use when
- El usuario pide “rediseñar” una pantalla o dashboard.
- Hay imagen/Figma como referencia.
- Se necesita mejorar UX sin romper métricas ni filtros.

## Workflow
1. **Mapear referencia**
   - Jerarquía visual: título, filtros, KPIs, tabla, gráficos.
   - Densidad de información y prioridades.
2. **Definir layout**
   - Grid principal (desktop + responsive).
   - Componentes reutilizables (filtros, cards, tabla, chart-card).
3. **Aplicar sistema visual**
   - Escala tipográfica consistente.
   - Paleta y tokens (evitar colores hardcode dispersos).
   - Espaciado uniforme.
4. **Estados UX**
   - Loading, empty, error, success.
   - Mensajes cortos y accionables.
5. **Validación de integridad de datos**
   - La UI no recalcula distinto al backend.
   - Tabla y gráficos consumen el mismo payload.

## QA checklist
- [ ] La estructura visual replica intención de referencia.
- [ ] Tabla legible y sticky headers si aplica.
- [ ] Gráficos no contradicen tabla.
- [ ] Filtros afectan todas las secciones.
- [ ] Responsive usable en ancho reducido.
- [ ] Contraste y foco aceptables.

## Output format
```markdown
## UI UX Delivery Summary
- Visual changes:
- Interaction changes:
- Data integrity checks:
- Responsive checks:
- Remaining improvements:
```
