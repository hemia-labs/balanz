# Instrucciones de diseño del frontend

Antes de cambiar UI, UX, estilos, componentes, layout, responsive, iconografía, gráficas o microcopy, lee y aplica ../../docs/design/ACCOUNTING_UI_DESIGN_AGENT.md.

Antes de cambiar navegación, rutas, sidebars, layouts, contextos de despacho/cliente o pantallas contables, lee también ../../docs/product/ACCOUNTING_INFORMATION_ARCHITECTURE.md.

- Estos documentos son normativos para apps/web.
- No introduzcas colores, radios, sombras ni espaciados arbitrarios.
- Revisa las dependencias visuales existentes antes de agregar otra.
- No hagas cambios masivos de formato ni edites código no relacionado.
- Ejecuta npm --prefix apps/web run lint, npx tsc --noEmit -p apps/web/tsconfig.json y npm --prefix apps/web run build.
- Si hay conflicto, las reglas funcionales, de seguridad, privacidad, contabilidad y accesibilidad tienen prioridad sobre la preferencia estética.
