import { DownloadCloud, FileArchive, Upload } from "lucide-react";
import { ActionDialog } from "@/components/overlay-dialog";
import { PermissionGate } from "@/components/permission-gate";
import { FeaturePendingNotice, Field } from "@/components/product-patterns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const selectClass =
  "h-10 w-full rounded-md border border-input bg-card px-3 text-body-sm";

export function CfdiActions({
  clientName,
  periodLabel,
  exportScope = "Resultados filtrados",
  includeExport = true,
}: {
  clientName: string;
  periodLabel: string;
  exportScope?: string;
  includeExport?: boolean;
}) {
  return (
    <>
      <PermissionGate capability="sat.download" explainReauthentication>
        <ActionDialog
          trigger={
            <Button>
              <DownloadCloud />
              Descargar del SAT
            </Button>
          }
          title="Iniciar descarga SAT"
          description={`${clientName} · ${periodLabel}`}
          confirmLabel="Solicitar descarga"
        >
          <FeaturePendingNotice>
            No existe integración SAT. La solicitud no se enviará.
          </FeaturePendingNotice>
          <Field label="Período">
            <Input value={periodLabel} readOnly />
          </Field>
          <Field label="Tipo de CFDI">
            <select className={selectClass} defaultValue="ambos">
              <option value="ambos">Emitidos y recibidos</option>
              <option value="emitidos">Emitidos</option>
              <option value="recibidos">Recibidos</option>
            </select>
          </Field>
        </ActionDialog>
      </PermissionGate>

      <ActionDialog
        trigger={
          <Button variant="outline">
            <Upload />
            Cargar XML o ZIP
          </Button>
        }
        title="Cargar XML o ZIP"
        description={`${clientName} · ${periodLabel}`}
        confirmLabel="Cargar archivos"
      >
        <FeaturePendingNotice>
          No se transferirán archivos. El servicio de cargas está pendiente.
        </FeaturePendingNotice>
        <Field label="Archivos">
          <Input type="file" accept=".xml,.zip" multiple />
        </Field>
      </ActionDialog>

      {includeExport ? (
        <PermissionGate capability="exports.generate" explainReauthentication>
          <ActionDialog
            trigger={
              <Button variant="outline">
                <FileArchive />
                Exportar
              </Button>
            }
            title="Configurar exportación"
            description="Define formato y alcance sin generar todavía el archivo."
            confirmLabel="Generar exportación"
          >
            <FeaturePendingNotice>
              El servicio de exportación no está conectado.
            </FeaturePendingNotice>
            <Field label="Formato">
              <select className={selectClass} defaultValue="xlsx">
                <option value="xlsx">Excel (.xlsx)</option>
                <option value="csv">CSV</option>
                <option value="xml">ZIP de XML</option>
              </select>
            </Field>
            <Field label="Alcance">
              <select className={selectClass} defaultValue="contexto">
                <option value="contexto">{exportScope}</option>
                <option value="seleccion">CFDI seleccionados</option>
              </select>
            </Field>
          </ActionDialog>
        </PermissionGate>
      ) : null}
    </>
  );
}
