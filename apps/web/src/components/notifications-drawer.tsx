"use client";

import Link from "next/link";
import { Bell } from "lucide-react";
import { useAccountingContext } from "@/components/accounting-context";
import { DetailDrawer } from "@/components/overlay-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { demoData } from "@/lib/demo-data";

const variants = { info: "info", warning: "warning", danger: "destructive", success: "success" } as const;

export function NotificationsDrawer() {
  const { organization } = useAccountingContext();
  return (
    <DetailDrawer
      trigger={<Button type="button" variant="ghost" size="icon" aria-label="Abrir notificaciones"><Bell className="size-4" /><span className="sr-only">4 notificaciones</span></Button>}
      title="Notificaciones"
      description="Eventos de los contextos a los que tienes acceso."
    >
      <div className="space-y-2">
        {demoData.notifications.map((item) => (
          <Link key={item.id} href={`/es${item.href}`} className="block rounded-lg border border-border p-4 hover:bg-muted/55">
            <div className="flex items-start justify-between gap-3"><p className="font-semibold">{item.title}</p><Badge variant={variants[item.kind]}>{item.time}</Badge></div>
            <p className="mt-2 text-body-sm text-muted-foreground">{item.detail}</p>
          </Link>
        ))}
        <Link href={`/es/despachos/${organization.id}/procesos`} className="mt-4 inline-flex min-h-10 items-center font-semibold text-primary hover:underline">Abrir Centro de procesos</Link>
      </div>
    </DetailDrawer>
  );
}
