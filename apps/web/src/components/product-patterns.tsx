import Link from "next/link";
import type { ReactNode } from "react";
import { AlertTriangle, Info, LockKeyhole } from "lucide-react";
import { cn } from "@/lib/utils";

export function Surface({ children, className, labelledBy }: { children: ReactNode; className?: string; labelledBy?: string }) {
  return <section aria-labelledby={labelledBy} className={cn("rounded-lg border border-border bg-card", className)}>{children}</section>;
}

export function SurfaceHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return <div className="flex flex-col gap-3 border-b border-border px-5 py-4 sm:flex-row sm:items-start sm:justify-between"><div><h2 className="text-heading-sm font-emphasis">{title}</h2>{description ? <p className="mt-1 text-body-sm text-muted-foreground">{description}</p> : null}</div>{actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}</div>;
}

export function FilterBar({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-end gap-3 border-b border-border bg-muted/35 px-4 py-3">{children}</div>;
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="grid gap-1.5 text-body-sm font-semibold"><span>{label}</span>{children}</label>;
}

export function ProgressValue({ value, label }: { value: number; label?: string }) {
  return <div className="min-w-28"><div className="mb-1 flex justify-between text-caption"><span>{label ?? "Avance"}</span><span className="numeric font-semibold">{value}%</span></div><div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label={label ?? "Avance"} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value}><div className="h-full bg-primary" style={{ width: `${value}%` }} /></div></div>;
}

export function FeaturePendingNotice({ children }: { children: ReactNode }) {
  return <div className="flex gap-3 rounded-lg border border-info/30 bg-info-surface p-4 text-info"><Info className="mt-0.5 size-5 shrink-0" aria-hidden="true" /><p className="text-body-sm">{children}</p></div>;
}

export function PermissionNotice({ capability }: { capability: string }) {
  return <div className="flex gap-3 rounded-lg border border-warning/30 bg-warning-surface p-4 text-warning"><LockKeyhole className="mt-0.5 size-5 shrink-0" aria-hidden="true" /><p className="text-body-sm">Tu membresía demostrativa no incluye <span className="identifier">{capability}</span>. El backend deberá validar esta restricción.</p></div>;
}

export function WarningNotice({ children }: { children: ReactNode }) {
  return <div className="flex gap-3 rounded-lg border border-warning/30 bg-warning-surface p-4 text-warning"><AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden="true" /><p className="text-body-sm">{children}</p></div>;
}

export function SectionTabs({ items, active }: { items: { label: string; href: string; id: string }[]; active: string }) {
  return <nav aria-label="Vistas de la sección" className="overflow-x-auto border-b border-border"><div className="flex min-w-max gap-1 px-2">{items.map((item) => <Link key={item.id} href={item.href} aria-current={active === item.id ? "page" : undefined} className={cn("relative flex min-h-11 items-center px-3 text-body-sm font-semibold text-muted-foreground hover:text-foreground", active === item.id && "text-foreground after:absolute after:bottom-0 after:left-3 after:right-3 after:h-0.5 after:bg-brand-mark")}>{item.label}</Link>)}</div></nav>;
}

export function DefinitionGrid({ items }: { items: { label: string; value: ReactNode }[] }) {
  return <dl className="grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2 xl:grid-cols-4">{items.map((item) => <div key={item.label} className="bg-card p-4"><dt className="text-caption font-semibold text-muted-foreground">{item.label}</dt><dd className="mt-1 text-body font-semibold">{item.value}</dd></div>)}</dl>;
}
