"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { Archive, MoreHorizontal, Pencil, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { archiveClient } from "./api";
import { ErrorNotice } from "./live-screen-primitives";
import { acquireSubmissionLock, releaseSubmissionLock } from "./submission-guard";
import type { ClientAccount } from "./types";

export function ClientRowActions({ account, base, canManage, canAssign, onArchived }: {
  account: ClientAccount;
  base: string;
  canManage: boolean;
  canAssign: boolean;
  onArchived: () => void;
}) {
  const [action, setAction] = useState<"archive" | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const submissionLock = useRef(false);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const editable = account.status !== "archived";
  const clientBase = `${base}/clients/${account.id}`;

  function openAction() {
    setError(null);
    setAction("archive");
  }

  async function submit() {
    if (!action || !canManage || !editable || !acquireSubmissionLock(submissionLock)) return;
    setPending(true);
    setError(null);
    try {
      await archiveClient(account.id);
      setAction(null);
      onArchived();
    } catch (cause) {
      setError(cause);
    } finally {
      releaseSubmissionLock(submissionLock);
      setPending(false);
    }
  }

  return (
    <div className="flex items-center justify-end gap-1">
      <Button render={<Link href={`${clientBase}/overview`} />} variant="ghost" size="sm" className="pointer-coarse:min-h-11" aria-label={`Ver cliente ${account.name}`}>
        Ver
      </Button>
      {editable && (canManage || canAssign) ? (
        <>
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger render={<DropdownMenuTrigger render={<Button ref={menuTrigger} variant="ghost" size="icon-sm" className="pointer-coarse:min-h-11 pointer-coarse:min-w-11" />} />} aria-label={`Más acciones de ${account.name}`}>
                <MoreHorizontal aria-hidden="true" />
              </TooltipTrigger>
              <TooltipContent>Más acciones</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end" className="w-64">
              {canManage && editable ? (
                <DropdownMenuItem render={<Link href={`${clientBase}/settings/data`} />} className="pointer-coarse:min-h-11">
                  <Pencil aria-hidden="true" />Editar datos
                </DropdownMenuItem>
              ) : null}
              {canAssign && editable ? (
                <DropdownMenuItem render={<Link href={`${clientBase}/settings/responsibles`} />} className="pointer-coarse:min-h-11">
                  <Users aria-hidden="true" />Gestionar responsables
                </DropdownMenuItem>
              ) : null}
              {canManage ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onClick={openAction} className="pointer-coarse:min-h-11">
                    <Archive aria-hidden="true" />Archivar cliente
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
          <Dialog open={action !== null} onOpenChange={(open) => { if (!open && !submissionLock.current) setAction(null); }}>
            <DialogContent initialFocus={cancelButton} finalFocus={menuTrigger}>
              <DialogHeader>
                <DialogTitle>Archivar cliente</DialogTitle>
                <DialogDescription>
                  {`¿Archivar a ${account.name}? Dejará de estar disponible para la operación habitual. Sus datos se conservan, pero actualmente no existe una opción para restaurarlo.`}
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
              {error ? <div className="px-5 pb-4"><ErrorNotice error={error} fallback="No se pudo completar la acción. Revisa los datos e intenta de nuevo." /></div> : null}
              <DialogFooter className="flex-col-reverse sm:flex-row">
                <Button type="button" ref={cancelButton} variant="outline" disabled={pending} onClick={() => setAction(null)}>Cancelar</Button>
                <Button type="submit" variant="destructive" disabled={pending || !canManage || !editable}>
                  {pending ? "Archivando…" : "Archivar cliente"}
                </Button>
              </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </>
      ) : null}
    </div>
  );
}
