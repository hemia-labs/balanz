import Link from "next/link";
import { Eye, Plus, RefreshCw, UserPlus } from "lucide-react";
import { ActionDialog, DetailDrawer } from "@/components/overlay-dialog";
import { DefinitionGrid, FeaturePendingNotice, Field, FilterBar, ProgressValue, SectionTabs, Surface, SurfaceHeader } from "@/components/product-patterns";
import { ProductTable } from "@/components/product-table";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { clientById, clientsFor, demoData, membershipFor, organizationById } from "@/lib/demo-data";
import { organizationBase } from "@/lib/nav";
import { roleLabels } from "@/lib/permissions";

const selectClass = "h-10 rounded-md border border-input bg-card px-3 text-body-sm";

export function OrganizationHomeScreen({ organizationId }: { organizationId: string }) {
  const organization = organizationById(organizationId)!;
  const clients = clientsFor(organizationId);
  const base = organizationBase("es", organizationId);
  return <div className="space-y-6">
    <header className="flex flex-col gap-4 border-l-2 border-brand-mark pl-4 sm:flex-row sm:items-start sm:justify-between">
      <div><p className="text-caption font-semibold text-accent-foreground">Inicio del despacho</p><h1 className="text-heading-lg font-bold">Mesa de control</h1><p className="mt-1 text-body text-muted-foreground">Prioriza clientes, incidencias y procesos del período seleccionado en {organization.name}.</p></div>
      <Field label="Período global"><select className={selectClass} defaultValue="08-2026"><option value="08-2026">Agosto 2026</option><option value="07-2026">Julio 2026</option></select></Field>
    </header>
    <DefinitionGrid items={[
      { label: "Clientes visibles", value: clients.length },
      { label: "Requieren atención", value: clients.filter((client) => client.incidents > 0).length },
      { label: "Procesos activos", value: demoData.processes.filter((process) => process.status === "En proceso").length },
      { label: "Errores recuperables", value: demoData.processes.filter((process) => process.status === "Con errores").length },
    ]} />
    <Surface>
      <SurfaceHeader title="Cartera del período" description="La tabla es el punto principal de decisión; los indicadores resumen el mismo conjunto." />
      <FilterBar><Field label="Estado"><select className={selectClass}><option>Todos los estados</option><option>En revisión</option><option>Con novedades</option></select></Field><Field label="Responsable"><select className={selectClass}><option>Todos</option><option>Mariana Torres</option><option>Ángel Ruiz</option></select></Field><Button variant="outline">Limpiar filtros</Button></FilterBar>
      <ProductTable caption="Estado operativo de clientes" rows={clients} rowKey={(row) => row.id} columns={[
        { id: "client", header: "Cliente", render: (row) => <div><Link className="font-semibold text-primary hover:underline" href={`${base}/clientes/${row.id}/resumen`}>{row.name}</Link><p className="identifier text-caption text-muted-foreground">{row.rfc}</p></div> },
        { id: "period", header: "Período", render: (row) => row.currentPeriod },
        { id: "status", header: "Estado", render: (row) => <StatusBadge status={row.status} /> },
        { id: "progress", header: "Avance", render: (row) => <ProgressValue value={row.progress} /> },
        { id: "incidents", header: "Incidencias", numeric: true, render: (row) => row.incidents },
        { id: "cutoff", header: "Último corte", render: (row) => row.lastCutoff },
        { id: "responsible", header: "Responsable", render: (row) => row.responsible },
        { id: "action", header: "Acción", render: (row) => <div className="flex gap-1"><Button render={<Link href={`${base}/clientes/${row.id}/ejercicios/2026/periodos/08/resumen`} />} variant="outline" size="sm">Abrir período</Button><DetailDrawer trigger={<Button variant="ghost" size="icon-sm" aria-label={`Vista rápida de ${row.name}`}><Eye /></Button>} title={row.name} description={row.rfc}><DefinitionGrid items={[{ label: "Estado", value: <StatusBadge status={row.status} /> }, { label: "Avance", value: `${row.progress}%` }, { label: "Incidencias", value: row.incidents }, { label: "e.firma", value: <StatusBadge status={row.eSignature} /> }]} /><Button render={<Link href={`${base}/clientes/${row.id}/resumen`} />} className="mt-5">Abrir cliente</Button></DetailDrawer></div> },
      ]} />
    </Surface>
    <div className="grid gap-6 xl:grid-cols-2">
      <Surface><SurfaceHeader title="Continuar trabajando" description="Contextos visitados recientemente." /><div className="divide-y divide-border">{clients.slice(0, 2).map((client) => <Link key={client.id} href={`${base}/clientes/${client.id}/resumen`} className="flex min-h-14 items-center justify-between px-5 py-3 hover:bg-muted/55"><span><span className="block font-semibold">{client.name}</span><span className="text-caption text-muted-foreground">{client.lastActivity}</span></span><StatusBadge status={client.status} /></Link>)}</div></Surface>
      <Surface><SurfaceHeader title="Procesos recientes" description="Trabajos autorizados del despacho." /><div className="divide-y divide-border">{demoData.processes.slice(0, 3).map((process) => <Link key={process.id} href={`${base}/procesos`} className="flex min-h-14 items-center justify-between px-5 py-3 hover:bg-muted/55"><span><span className="block font-semibold">{process.type}</span><span className="text-caption text-muted-foreground">{clientById(organizationId, process.clientId)?.name}</span></span><StatusBadge status={process.status} /></Link>)}</div></Surface>
    </div>
  </div>;
}

export function ClientsScreen({ organizationId }: { organizationId: string }) {
  const rows = clientsFor(organizationId);
  const base = organizationBase("es", organizationId);
  return <div className="space-y-6"><header className="flex flex-col gap-4 border-l-2 border-brand-mark pl-4 sm:flex-row sm:items-start sm:justify-between"><div><p className="text-caption font-semibold text-accent-foreground">Despacho</p><h1 className="text-heading-lg font-bold">Clientes</h1><p className="mt-1 text-body text-muted-foreground">Consulta contribuyentes asignados, conexión SAT, e.firma y actividad reciente.</p></div><ActionDialog trigger={<Button><Plus />Nuevo cliente</Button>} title="Crear cliente" description="Captura la identidad base. La persistencia requiere el servicio de clientes." confirmLabel="Crear cliente"><FeaturePendingNotice>Interfaz preparada; integración funcional pendiente.</FeaturePendingNotice><div className="grid gap-4 sm:grid-cols-2"><Field label="Razón social"><Input placeholder="Empresa Demo" /></Field><Field label="RFC"><Input placeholder="DEM010101AA1" /></Field><Field label="Responsable"><select className={selectClass}><option>Mariana Torres</option><option>Ángel Ruiz</option></select></Field><Field label="Ejercicio inicial"><Input type="number" defaultValue="2026" /></Field></div></ActionDialog></header><Surface><FilterBar><Field label="Buscar"><Input placeholder="Nombre o RFC" className="w-64" /></Field><Field label="Estado"><select className={selectClass}><option>Todos</option><option>En revisión</option></select></Field><Field label="e.firma"><select className={selectClass}><option>Todas</option><option>Vigente</option><option>Vencida</option></select></Field></FilterBar><ProductTable caption="Directorio de clientes" rows={rows} rowKey={(row) => row.id} columns={[
    { id: "client", header: "Cliente", render: (row) => <div><Link href={`${base}/clientes/${row.id}/resumen`} className="font-semibold text-primary hover:underline">{row.name}</Link><p className="identifier text-caption text-muted-foreground">{row.rfc}</p></div> },
    { id: "responsible", header: "Responsable", render: (row) => row.responsible },
    { id: "period", header: "Período actual", render: (row) => row.currentPeriod },
    { id: "status", header: "Estado", render: (row) => <StatusBadge status={row.status} /> },
    { id: "signature", header: "e.firma", render: (row) => <StatusBadge status={row.eSignature} /> },
    { id: "sat", header: "SAT", render: (row) => <StatusBadge status={row.satConnection} /> },
    { id: "activity", header: "Última actividad", render: (row) => row.lastActivity },
    { id: "action", header: "Acción", render: (row) => <Button render={<Link href={`${base}/clientes/${row.id}/resumen`} />} variant="outline" size="sm">Abrir cliente</Button> },
  ]} /></Surface></div>;
}

export function ProcessesScreen({ organizationId }: { organizationId: string }) {
  const base = organizationBase("es", organizationId);
  const tabs = ["Descargas SAT", "Cargas manuales", "Exportaciones", "Archivos fiscales", "Errores y reintentos"].map((label, index) => ({ id: String(index), label, href: `${base}/procesos?vista=${index}` }));
  return <div className="space-y-6"><header className="border-l-2 border-brand-mark pl-4"><p className="text-caption font-semibold text-accent-foreground">Operación global</p><h1 className="text-heading-lg font-bold">Centro de procesos</h1><p className="mt-1 text-body text-muted-foreground">Supervisa descargas, cargas, exportaciones y trabajos fiscales sin perder el contexto del cliente.</p></header><Surface><SectionTabs items={tabs} active="0" /><ProductTable caption="Procesos del despacho" rows={demoData.processes.filter((process) => clientById(organizationId, process.clientId))} rowKey={(row) => row.id} columns={[
    { id: "type", header: "Tipo", render: (row) => <div><p className="font-semibold">{row.type}</p><p className="identifier text-caption text-muted-foreground">{row.id}</p></div> },
    { id: "client", header: "Cliente", render: (row) => clientById(organizationId, row.clientId)?.name },
    { id: "period", header: "Período", render: (row) => row.period },
    { id: "status", header: "Estado Hemia", render: (row) => <StatusBadge status={row.status} /> },
    { id: "progress", header: "Progreso", render: (row) => <ProgressValue value={row.progress} /> },
    { id: "requester", header: "Solicitante", render: (row) => row.requestedBy },
    { id: "updated", header: "Actualización", render: (row) => row.updatedAt },
    { id: "action", header: "Acción", render: (row) => <DetailDrawer trigger={<Button variant="outline" size="sm"><Eye />Ver detalle</Button>} title={row.type} description={`${row.id} · ${row.period}`}><DefinitionGrid items={[{ label: "Estado", value: <StatusBadge status={row.status} /> }, { label: "Progreso", value: `${row.progress}%` }, { label: "Inicio", value: row.startedAt }, { label: "Resultado", value: row.result }]} />{row.status === "Con errores" ? <Button variant="outline" className="mt-5"><RefreshCw />Reintentar</Button> : null}<FeaturePendingNotice>El drawer no consulta ni muta procesos reales.</FeaturePendingNotice></DetailDrawer> },
  ]} /></Surface></div>;
}

export function TeamScreen({ organizationId }: { organizationId: string }) {
  const membership = membershipFor(organizationId)!;
  const base = organizationBase("es", organizationId);
  const members = [
    { id: "m1", name: "Mariana Torres", email: "mariana@example.test", role: "Titular", clients: "3 clientes", status: "Activo" },
    { id: "m2", name: "Ángel Ruiz", email: "angel@example.test", role: "Contador responsable", clients: "2 clientes", status: "Activo" },
    { id: "m3", name: "Lucía Soto", email: "lucia@example.test", role: "Colaborador/Auxiliar", clients: "1 cliente", status: "Invitación pendiente" },
  ];
  return <div className="space-y-6"><header className="flex flex-col gap-4 border-l-2 border-brand-mark pl-4 sm:flex-row sm:justify-between"><div><p className="text-caption font-semibold text-accent-foreground">Administración</p><h1 className="text-heading-lg font-bold">Equipo</h1><p className="mt-1 text-body text-muted-foreground">Gestiona membresías, perfiles, capacidades y asignaciones explícitas por cliente.</p></div><ActionDialog trigger={<Button><UserPlus />Invitar miembro</Button>} title="Invitar miembro" description="La invitación pertenecerá al despacho y no cambia la identidad global de la cuenta." confirmLabel="Enviar invitación"><FeaturePendingNotice>No existe servicio de invitaciones. No se enviará correo.</FeaturePendingNotice><Field label="Correo electrónico"><Input type="email" placeholder="persona@example.test" /></Field><Field label="Perfil inicial"><select className={selectClass}><option>Contador responsable</option><option>Colaborador/Auxiliar</option><option>Administrador</option></select></Field></ActionDialog></header><DefinitionGrid items={[{ label: "Tu perfil", value: roleLabels[membership.role] }, { label: "Miembros", value: members.length }, { label: "Invitaciones pendientes", value: 1 }, { label: "Clientes con asignación", value: membership.assignedClientIds.length }]} /><Surface><SectionTabs active="miembros" items={[{ id: "miembros", label: "Miembros", href: `${base}/equipo` }, { id: "invitaciones", label: "Invitaciones", href: `${base}/equipo?vista=invitaciones` }, { id: "perfiles", label: "Perfiles y capacidades", href: `${base}/equipo?vista=perfiles` }, { id: "asignaciones", label: "Asignaciones por cliente", href: `${base}/equipo?vista=asignaciones` }]} /><ProductTable caption="Miembros del despacho" rows={members} rowKey={(row) => row.id} columns={[
    { id: "name", header: "Miembro", render: (row) => <div><p className="font-semibold">{row.name}</p><p className="text-caption text-muted-foreground">{row.email}</p></div> },
    { id: "role", header: "Perfil", render: (row) => row.role },
    { id: "clients", header: "Asignaciones", render: (row) => row.clients },
    { id: "status", header: "Estado", render: (row) => <StatusBadge status={row.status} /> },
    { id: "action", header: "Acción", render: () => <Button variant="outline" size="sm">Revisar acceso</Button> },
  ]} /></Surface></div>;
}

export function AuditScreen() {
  const events = [
    { id: "a1", date: "18 ago 2026, 11:30", actor: "Mariana Torres", client: "Comercial del Sur Demo", action: "Solicitud de descarga SAT", module: "Procesos", severity: "Información" },
    { id: "a2", date: "18 ago 2026, 10:07", actor: "Ángel Ruiz", client: "Servicios del Bajío Demo", action: "Carga manual con observaciones", module: "CFDI", severity: "Advertencia" },
    { id: "a3", date: "17 ago 2026, 16:44", actor: "Lucía Soto", client: "Taller Orión Demo", action: "Exportación preparada", module: "Exportaciones", severity: "Información" },
  ];
  return <div className="space-y-6"><header className="border-l-2 border-brand-mark pl-4"><p className="text-caption font-semibold text-accent-foreground">Trazabilidad</p><h1 className="text-heading-lg font-bold">Auditoría</h1><p className="mt-1 text-body text-muted-foreground">Consulta eventos operativos sin exponer secretos, credenciales o XML completo.</p></header><Surface><FilterBar><Field label="Fecha"><Input type="date" defaultValue="2026-08-18" /></Field><Field label="Actor"><Input placeholder="Nombre" /></Field><Field label="Módulo"><select className={selectClass}><option>Todos</option><option>Procesos</option><option>CFDI</option></select></Field></FilterBar><ProductTable caption="Eventos de auditoría" rows={events} rowKey={(row) => row.id} columns={[
    { id: "date", header: "Fecha", render: (row) => row.date }, { id: "actor", header: "Actor", render: (row) => row.actor }, { id: "client", header: "Cliente", render: (row) => row.client }, { id: "action", header: "Acción", render: (row) => row.action }, { id: "module", header: "Módulo", render: (row) => row.module }, { id: "severity", header: "Severidad", render: (row) => <StatusBadge status={row.severity} /> },
  ]} /></Surface></div>;
}

const settingsLabels: Record<string, { title: string; description: string }> = {
  resumen: { title: "Configuración del despacho", description: "Administra datos, seguridad, licencia y soporte según tu capacidad." },
  datos: { title: "Datos del despacho", description: "Identidad operativa y preferencias generales del tenant." },
  seguridad: { title: "Seguridad", description: "Políticas y controles de acceso del despacho." },
  "plan-facturacion": { title: "Plan y facturación", description: "Propiedad contractual, plan y método de pago; sólo Titular." },
  "retencion-datos": { title: "Retención y exportación de datos", description: "Políticas de conservación y solicitudes autorizadas." },
  soporte: { title: "Soporte", description: "Acceso temporal y ayuda sin convertir soporte en un rol permanente." },
};

export function OrganizationSettingsScreen({ organizationId, section = "resumen" }: { organizationId: string; section?: string }) {
  const base = `${organizationBase("es", organizationId)}/configuracion`;
  const copy = settingsLabels[section] ?? settingsLabels.resumen;
  const links = [{ id: "datos", label: "Datos", href: `${base}/datos` }, { id: "seguridad", label: "Seguridad", href: `${base}/seguridad` }, { id: "plan-facturacion", label: "Plan y facturación", href: `${base}/plan-facturacion` }, { id: "retencion-datos", label: "Retención de datos", href: `${base}/retencion-datos` }, { id: "soporte", label: "Soporte", href: `${base}/soporte` }];
  return <div className="space-y-6"><header className="border-l-2 border-brand-mark pl-4"><p className="text-caption font-semibold text-accent-foreground">Administración del despacho</p><h1 className="text-heading-lg font-bold">{copy.title}</h1><p className="mt-1 text-body text-muted-foreground">{copy.description}</p></header><Surface><SectionTabs items={links} active={section} /><div className="space-y-5 p-5"><FeaturePendingNotice>Los controles están preparados para contratos futuros; ningún cambio se persiste.</FeaturePendingNotice>{section === "plan-facturacion" ? <DefinitionGrid items={[{ label: "Propietaria contractual", value: "Mariana Torres" }, { label: "Plan", value: "Sin contrato conectado" }, { label: "Método de pago", value: "No disponible" }, { label: "Renovación", value: "No disponible" }]} /> : <div className="grid max-w-form gap-5 sm:grid-cols-2"><Field label="Nombre del despacho"><Input defaultValue="Estudio Contable Norte" /></Field><Field label="Zona horaria"><select className={selectClass}><option>America/Mexico_City</option></select></Field><Field label="Correo operativo"><Input type="email" defaultValue="operacion@example.test" /></Field><Field label="Preferencia de período"><select className={selectClass}><option>Mes actual</option></select></Field></div>}<div className="flex justify-end"><Button disabled>Guardar cambios</Button></div></div></Surface></div>;
}
