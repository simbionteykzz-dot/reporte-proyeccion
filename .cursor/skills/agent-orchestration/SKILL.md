---
name: agent-orchestration
description: Orquesta el uso de agentes especializados del proyecto y sus playbooks migrados. Usar cuando la tarea requiera dividir trabajo por arquitectura, frontend, UX, datos, performance o SQL.
---

# Agent Orchestration

## Objetivo
Usar el agente correcto según el tipo de tarea y mantener trazabilidad de decisiones.

## Playbooks disponibles
- Referencia local: `.cursor/agents-migrated/*.md`
- Subagentes nativos recomendados:
  - `backend-architect`
  - `frontend-developer`
  - `fullstack-developer`
  - `ui-ux-designer`
  - `database-optimization`
  - `sql-pro`
  - `react-performance-optimization`
  - `react-performance-optimizer`
  - `javascript-pro`
  - `nextjs-architecture-expert`
  - `error-detective`
  - `data-engineer`
  - `data-scientist`

## Regla de selección rápida
- Arquitectura/API: `backend-architect`
- UI/UX y diseño visual: `ui-ux-designer`
- Implementación UI completa: `frontend-developer`
- Feature end-to-end: `fullstack-developer`
- SQL lento o schema: `sql-pro` o `database-optimization`
- Performance React: `react-performance-optimization` o `react-performance-optimizer`
- Debug de fallos: `error-detective`

## Salida mínima esperada
- Agente(s) usados
- Qué validó cada agente
- Riesgos abiertos
