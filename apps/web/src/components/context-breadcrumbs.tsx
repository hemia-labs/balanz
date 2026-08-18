"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { usePathname } from "next/navigation";
import { useAccountingContext } from "@/components/accounting-context";
import { demoData } from "@/lib/demo-data";
import { clientBase, organizationBase } from "@/lib/nav";

interface BreadcrumbItem {
  label: string;
  href?: string;
}

const labels: Record<string, string> = {
  inicio: "Inicio",
  clientes: "Clientes",
  procesos: "Procesos",
  equipo: "Equipo",
  auditoria: "Auditoría",
  configuracion: "Configuración",
  resumen: "Resumen",
  ejercicios: "Ejercicios",
  cfdi: "CFDI",
  alertas: "Alertas",
  obligaciones: "Obligaciones",
  diot: "DIOT",
  ieps: "IEPS",
  cierre: "Checklist y cierre",
  exportaciones: "Exportaciones",
  pagos: "Pagos",
  nomina: "Nómina",
  incidencias: "Incidencias",
  "e-firma-sat": "e.firma y SAT",
  responsables: "Responsables",
  accesos: "Accesos",
};

function readableLabel(segment: string) {
  return labels[segment] ?? segment.replaceAll("-", " ");
}

function monthLabel(slug: string) {
  return demoData.periods.find((period) => period.slug === slug)?.month ?? `Período ${slug}`;
}

function buildClientTrail(relative: string[], clientHref: string): BreadcrumbItem[] {
  const [section = "resumen", second, third, fourth, fifth] = relative;

  if (section === "ejercicios") {
    if (!second) return [{ label: "Ejercicios" }];
    if (third !== "periodos" || !fourth) {
      return [
        { label: "Ejercicios", href: `${clientHref}/ejercicios` },
        { label: `Ejercicio ${second}` },
      ];
    }

    const periodHref = `${clientHref}/ejercicios/${second}/periodos/${fourth}`;
    return [
      { label: `Ejercicio ${second}`, href: `${clientHref}/ejercicios/${second}` },
      { label: monthLabel(fourth), href: periodHref },
      { label: readableLabel(fifth ?? "resumen") },
    ];
  }

  if (section === "cfdi" && second) {
    return [
      { label: "CFDI", href: `${clientHref}/cfdi` },
      { label: "Detalle CFDI" },
    ];
  }

  if (section === "obligaciones" && second) {
    const trail: BreadcrumbItem[] = [
      { label: "Obligaciones", href: `${clientHref}/obligaciones` },
    ];
    if (second === "diot" || second === "ieps") {
      trail.push({ label: readableLabel(second), href: `${clientHref}/obligaciones/${second}` });
      if (second === "diot" && third && fourth) {
        trail.push({ label: `${monthLabel(fourth)} ${third}`, href: `${clientHref}/obligaciones/diot/${third}/${fourth}` });
        trail.push({ label: readableLabel(fifth ?? "resumen") });
      } else if (second === "ieps" && third) {
        trail.push({ label: readableLabel(fourth ?? "resumen") });
      }
      return trail;
    }
    trail.push({ label: readableLabel(second) });
    return trail;
  }

  if (section === "configuracion" && second) {
    return [
      { label: "Configuración", href: `${clientHref}/configuracion/datos` },
      { label: readableLabel(second) },
    ];
  }

  return [{ label: readableLabel(section) }];
}

export function ContextBreadcrumbs() {
  const pathname = usePathname();
  const { client, organization } = useAccountingContext();
  const parts = pathname.split("/").filter(Boolean);
  const organizationIndex = parts.indexOf("despachos");
  const organizationSection = organizationIndex >= 0 ? parts[organizationIndex + 2] : undefined;
  const organizationHref = `${organizationBase("es", organization.id)}/inicio`;
  const items: BreadcrumbItem[] = [{ label: organization.shortName, href: organizationHref }];

  if (client) {
    const clientHref = clientBase("es", organization.id, client.id);
    const clientIndex = parts.indexOf("clientes");
    const relative = clientIndex >= 0 ? parts.slice(clientIndex + 2) : [];
    items.push({ label: client.name, href: `${clientHref}/resumen` });
    items.push(...buildClientTrail(relative, clientHref));
  } else if (organizationSection && organizationSection !== "inicio") {
    const sectionHref = `${organizationBase("es", organization.id)}/${organizationSection}`;
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
