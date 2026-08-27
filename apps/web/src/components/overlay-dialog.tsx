"use client";

import { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ControlledDialog({
  open,
  onClose,
  title,
  description,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      className="m-auto w-[calc(100%-2rem)] max-w-2xl rounded-lg border border-border bg-card p-0 text-card-foreground shadow-overlay"
    >
      <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
        <div>
          <h2 id={titleId} className="text-heading-sm font-emphasis">
            {title}
          </h2>
          <p
            id={descriptionId}
            className="mt-1 text-body-sm text-muted-foreground"
          >
            {description}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => dialogRef.current?.close()}
          aria-label="Cerrar"
        >
          <X />
        </Button>
      </div>
      {children}
    </dialog>
  );
}

export function ActionDialog({
  trigger,
  title,
  description,
  children,
  confirmLabel = "Integración pendiente",
  confirmDisabled = true,
}: {
  trigger: React.ReactNode;
  title: string;
  description: string;
  children?: React.ReactNode;
  confirmLabel?: string;
  confirmDisabled?: boolean;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  return (
    <>
      <span onClick={() => dialogRef.current?.showModal()}>{trigger}</span>
      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="m-auto w-[calc(100%-2rem)] max-w-xl rounded-lg border border-border bg-card p-0 text-card-foreground shadow-overlay"
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div>
            <h2 id={titleId} className="text-heading-sm font-emphasis">
              {title}
            </h2>
            <p
              id={descriptionId}
              className="mt-1 text-body-sm text-muted-foreground"
            >
              {description}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => dialogRef.current?.close()}
            aria-label="Cerrar"
          >
            <X className="size-4" />
          </Button>
        </div>
        <div className="space-y-4 px-5 py-5">{children}</div>
        <div className="flex flex-col-reverse gap-2 border-t border-border px-5 py-4 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={() => dialogRef.current?.close()}
          >
            Cancelar
          </Button>
          <Button type="button" disabled={confirmDisabled}>
            {confirmLabel}
          </Button>
        </div>
      </dialog>
    </>
  );
}

export function DetailDrawer({
  trigger,
  title,
  description,
  children,
}: {
  trigger: React.ReactNode;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  return (
    <>
      <span onClick={() => dialogRef.current?.showModal()}>{trigger}</span>
      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        className="ml-auto mr-0 mt-0 h-dvh w-full max-w-lg border-0 border-l border-border bg-card p-0 text-card-foreground shadow-overlay"
      >
        <div className="flex min-h-full flex-col">
          <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
            <div>
              <h2 id={titleId} className="text-heading-sm font-emphasis">
                {title}
              </h2>
              {description ? (
                <p
                  id={descriptionId}
                  className="mt-1 text-body-sm text-muted-foreground"
                >
                  {description}
                </p>
              ) : null}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => dialogRef.current?.close()}
              aria-label="Cerrar"
            >
              <X className="size-4" />
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-5">{children}</div>
        </div>
      </dialog>
    </>
  );
}
