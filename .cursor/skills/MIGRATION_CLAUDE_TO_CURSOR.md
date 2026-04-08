# Claude to Cursor Migration

This project now includes migrated skills and agents from `.claude`.

## Migrated Skills

The following skills were copied into `.cursor/skills` and are now available to be used by name:

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

## Migrated Agent Playbooks

Agent playbook docs from `.claude/agents` were copied to:

- `.cursor/agents-migrated`

This includes:

- `backend-architect`
- `data-engineer`
- `data-scientist`
- `database-optimization`
- `error-detective`
- `frontend-developer`
- `fullstack-developer`
- `javascript-pro`
- `nextjs-architecture-expert`
- `react-performance-optimization`
- `react-performance-optimizer`
- `sql-pro`
- `ui-ux-designer`

## Usage Notes

- Cursor natively executes built-in subagent types (for example `frontend-developer`, `ui-ux-designer`).
- The files in `.cursor/agents-migrated` act as local playbooks/reference docs for those agent roles.
- Skills in `.cursor/skills` are now first-class project skills and can be loaded directly.
