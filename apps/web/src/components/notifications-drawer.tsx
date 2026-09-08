"use client";

import Link from "next/link";
import { Bell } from "lucide-react";
import { usePathname } from "next/navigation";
import { useAccountingContext } from "@/components/accounting-context";
import { DetailDrawer } from "@/components/overlay-dialog";
import { Button } from "@/components/ui/button";

export function NotificationsDrawer() {
  const pathname = usePathname();
  const { organization, isDemo } = useAccountingContext();
  const locale = pathname.split("/").filter(Boolean)[0] ?? "es";
  return (
    <DetailDrawer
      trigger={<Button type="button" variant="ghost" size="icon" aria-label="Abrir notificaciones"><Bell className="size-4" /></Button>}
      title="Notificaciones"
      description="Eventos de los contextos a los que tienes acceso."
    >
      <div className="space-y-2">
        {isDemo ? <p className="rounded-lg border border-border p-4 text-body-sm text-muted-foreground">Las notificaciones demo sólo están disponibles en modo demo.</p> : <p className="rounded-lg border border-border p-4 text-body-sm text-muted-foreground">No hay notificaciones disponibles para este tenant.</p>}
        <Link href={`/${locale}/organizations/${organization.slug}/processes`} className="mt-4 inline-flex min-h-10 items-center font-semibold text-primary hover:underline">Abrir Centro de procesos</Link>
      </div>
    </DetailDrawer>
  );
}
