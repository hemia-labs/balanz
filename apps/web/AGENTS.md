# Instrucciones de diseño del frontend

Estas instrucciones heredan `../../AGENTS.md` y sólo añaden reglas específicas de `apps/web`.

Antes de cambiar UI, UX, estilos, componentes, layout, responsive, iconografía, gráficas o microcopy, lee y aplica ../../docs/design/ACCOUNTING_UI_DESIGN_AGENT.md.

Antes de cambiar navegación, rutas, sidebars, layouts, contextos de despacho/cliente o pantallas contables, lee también ../../docs/product/ACCOUNTING_INFORMATION_ARCHITECTURE.md.

- Estos documentos son normativos para apps/web.
- No introduzcas colores, radios, sombras ni espaciados arbitrarios.
- Revisa las dependencias visuales existentes antes de agregar otra.
- No hagas cambios masivos de formato ni edites código no relacionado.
- Ejecuta `bun run --cwd apps/web lint`, `bun run --cwd apps/web typecheck`,
  `bun run --cwd apps/web test` y `bun run --cwd apps/web build`.
- Si hay conflicto, las reglas funcionales, de seguridad, privacidad, contabilidad y accesibilidad tienen prioridad sobre la preferencia estética.
