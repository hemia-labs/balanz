"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { usePathname } from "next/navigation";
import { useAccountingContext } from "@/components/accounting-context";
import { clientBase, organizationBase } from "@/lib/nav";

interface BreadcrumbItem {
  label: string;
  href?: string;
}

const labels: Record<string, string> = {
  home: "Inicio",
  clients: "Clientes",
  processes: "Procesos",
  team: "Equipo",
  audit: "Auditoría",
  settings: "Configuración",
  overview: "Resumen",
  "fiscal-years": "Ejercicios",
  cfdi: "CFDI",
  alerts: "Alertas",
  obligations: "Obligaciones",
  diot: "DIOT",
  ieps: "IEPS",
  close: "Checklist y cierre",
  exports: "Exportaciones",
  payments: "Pagos",
  payroll: "Nómina",
  issues: "Incidencias",
  "e-signature-sat": "e.firma y SAT",
  responsibles: "Responsables",
  access: "Accesos",
  data: "Datos del cliente",
};

function readableLabel(segment: string) {
  return labels[segment] ?? segment.replaceAll("-", " ");
}

function monthLabel(slug: string) {
  return `Período ${slug}`;
}

function buildClientTrail(relative: string[], clientHref: string): BreadcrumbItem[] {
  const [section = "overview", second, third, fourth, fifth] = relative;

  if (section === "fiscal-years") {
    if (!second) return [{ label: "Ejercicios" }];
    if (third !== "periods" || !fourth) {
      return [
        { label: "Ejercicios", href: `${clientHref}/fiscal-years` },
        { label: `Ejercicio ${second}` },
      ];
    }

    const periodHref = `${clientHref}/fiscal-years/${second}/periods/${fourth}`;
    return [
      { label: `Ejercicio ${second}`, href: `${clientHref}/fiscal-years/${second}` },
      { label: monthLabel(fourth), href: periodHref },
      { label: readableLabel(fifth ?? "overview") },
    ];
  }

  if (section === "cfdi" && second) {
    return [
      { label: "CFDI", href: `${clientHref}/cfdi` },
      { label: "Detalle CFDI" },
    ];
  }

  if (section === "obligations" && second) {
    const trail: BreadcrumbItem[] = [
      { label: "Obligaciones", href: `${clientHref}/obligations` },
    ];
    if (second === "diot" || second === "ieps") {
      trail.push({ label: readableLabel(second), href: `${clientHref}/obligations/${second}` });
      if (second === "diot" && third && fourth) {
        trail.push({ label: `${monthLabel(fourth)} ${third}`, href: `${clientHref}/obligations/diot/${third}/${fourth}` });
        trail.push({ label: readableLabel(fifth ?? "overview") });
      } else if (second === "ieps" && third) {
        trail.push({ label: readableLabel(fourth ?? "overview") });
      }
      return trail;
    }
    trail.push({ label: readableLabel(second) });
    return trail;
  }

  if (section === "settings" && second) {
    return [
      { label: "Configuración", href: `${clientHref}/settings/data` },
      { label: readableLabel(second) },
    ];
  }

  return [{ label: readableLabel(section) }];
}

export function ContextBreadcrumbs() {
  const pathname = usePathname();
  const { client, organization } = useAccountingContext();
  const locale = pathname.split("/").filter(Boolean)[0] ?? "es";
  const parts = pathname.split("/").filter(Boolean);
  const organizationIndex = parts.indexOf("organizations");
  const organizationSection = organizationIndex >= 0 ? parts[organizationIndex + 2] : undefined;
  const organizationHref = `${organizationBase(locale, organization.slug)}/home`;
  const items: BreadcrumbItem[] = [{ label: organization.shortName, href: organizationHref }];

  if (client) {
    const clientHref = clientBase(locale, organization.slug, client.id);
    const clientIndex = parts.indexOf("clients");
    const relative = clientIndex >= 0 ? parts.slice(clientIndex + 2) : [];
    items.push({ label: client.name, href: `${clientHref}/overview` });
    items.push(...buildClientTrail(relative, clientHref));
  } else if (organizationSection && organizationSection !== "home") {
    const sectionHref = `${organizationBase(locale, organization.slug)}/${organizationSection}`;
    const subsection = parts[organizationIndex + 3];
    if (subsection) items.push({ label: readableLabel(organizationSection), href: sectionHref });
    items.push({ label: readableLabel(subsection ?? organizationSection) });
  }

  return (
    <nav aria-label="Ruta actual" className="hidden min-w-0 flex-1 lg:block">
      <ol className="flex min-w-0 items-center gap-1 text-body-sm">
        {items.map((item, index) => {
          const current = index === items.length - 1;
          return (
            <li key={`${item.label}-${index}`} className="flex min-w-0 items-center gap-1">
              {index > 0 ? <ChevronRight aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" /> : null}
              {item.href && !current ? (
                <Link href={item.href} className="block max-w-48 truncate font-semibold hover:underline">{item.label}</Link>
              ) : (
                <span aria-current={current ? "page" : undefined} className="block max-w-48 truncate text-muted-foreground">{item.label}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
