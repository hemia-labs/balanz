"use client";

import { apiErrorMessage } from "@/lib/api-client";

export const selectClass =
  "h-10 rounded-md border border-input bg-card px-3 text-body-sm";
export const roleLabels: Record<string, string> = {
  owner: "Titular",
  accountant: "Contador responsable",
  collaborator: "Colaborador",
};

export function ErrorNotice({
  error,
  fallback,
}: {
  error: unknown;
  fallback: string;
}) {
  if (!error) return null;
  return (
    <div
      role="alert"
      aria-live="assertive"
      className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-body-sm text-destructive"
    >
      {apiErrorMessage(error, fallback)}
    </div>
  );
}

export function LoadingState({
  label = "Cargando clientes…",
}: {
  label?: string;
}) {
  return (
    <div
      role="status"
      className="rounded-lg border border-border bg-card p-8 text-center text-body-sm text-muted-foreground"
    >
      {label}
    </div>
  );
}
