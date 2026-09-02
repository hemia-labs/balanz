# Web (Next.js)

Frontend del monorepo `nextjs-nestjs`. Plantilla Next.js (App Router) con Tailwind v4 y shadcn.


## Stack

- **Next.js 16** — App Router, React Server Components.
- **React 19**.
- **Tailwind CSS v4** — vía `@tailwindcss/postcss`, tokens en `src/app/globals.css`.
- **shadcn** (estilo `base-nova`, sobre **@base-ui/react**) — componentes en `src/components/ui`.
- **lucide-react** — iconos.
- **class-variance-authority**, **clsx**, **tailwind-merge** — variantes y merge de clases.
- **TypeScript**, **ESLint**. Temas claro y oscuro mediante tokens semánticos.
- Gestor de paquetes: **bun**.

## Estructura

```
apps/web/
  components.json                # config shadcn (style base-nova, baseColor neutral)
  src/
    app/
      layout.tsx                 # layout raíz
      page.tsx                   # home
      globals.css                # tokens Tailwind v4 + tema shadcn
      [section]/page.tsx         # ruta dinámica de ejemplo
    components/
      app-sidebar.tsx, app-topbar.tsx, stat-card.tsx
      ui/                        # primitivos shadcn (button, input, badge, table)
    lib/
      nav.ts, utils.ts           # navegación y helper cn()
```

Aliases: `@/components`, `@/components/ui`, `@/lib`, `@/lib/utils`, `@/hooks`.

## Arranque

```bash
bun install
bun run --cwd apps/web dev      # http://localhost:5181
```

## Scripts

```bash
bun run --cwd apps/web dev
bun run --cwd apps/web build
bun run --cwd apps/web start
bun run --cwd apps/web lint
```

## Alcance fiscal actual

La Fase 0 de CFDI entrega únicamente la plataforma compartida del backend. No
añade al frontend un flujo de carga XML/ZIP, progreso de ingesta, lista o
detalle real de CFDI, descarga de originales, SAT, e.firma, mesa mensual ni
exportaciones. Las pantallas existentes de clientes, ejercicios y períodos no
constituyen evidencia de esas capacidades.

`PHASE_1_XML` permanece `NOT_STARTED`. No debe conectarse una UI de carga ni
eliminarse un fallback/demo fiscal hasta que la Fase 1 sea autorizada,
implementada y validada de extremo a extremo.

## Añadir componentes shadcn

```bash
bunx shadcn@latest add <componente>
```

Se instalan en `src/components/ui` según `components.json`.
