"use client";

import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiErrorMessage } from "@/lib/api-client";
import { disableTotp, setupTotp, verifyTotp } from "@/features/auth/api";
import { getSession } from "@/features/session/api";

type MfaStatus = "disabled" | "pending" | "active";
type SetupResponse = { factorId: string; secret: string; otpauthUri: string; status: "pending" };

export function MfaSettings({ compact = false, initialStatus }: { compact?: boolean; initialStatus?: MfaStatus }) {
  const [status, setStatus] = useState<MfaStatus | "loading" | "unavailable">(initialStatus ?? "loading");
  const [setup, setSetup] = useState<SetupResponse | null>(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [skipped, setSkipped] = useState(false);
  const [showDisable, setShowDisable] = useState(false);

  useEffect(() => {
    if (initialStatus) return;
    const controller = new AbortController();
    let active = true;
    void getSession(controller.signal)
      .then((session) => { if (active) setStatus(session.mfaStatus as MfaStatus); })
      .catch(() => { if (active) setStatus("unavailable"); });
    return () => { active = false; controller.abort(); };
  }, [initialStatus]);

  async function startSetup() {
    setBusy(true);
    setError("");
    try {
      const next = await setupTotp();
      setSetup(next);
      setStatus("pending");
    } catch (cause) {
      setError(apiErrorMessage(cause, "No se pudo iniciar la configuración."));
    } finally {
      setBusy(false);
    }
  }

  async function verifySetup(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await verifyTotp(code);
      setStatus("active");
      setSetup(null);
      setCode("");
    } catch (cause) {
      setError(apiErrorMessage(cause, "El código no es válido."));
    } finally {
      setBusy(false);
    }
  }

  async function disable(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await disableTotp(password, code);
      setStatus("disabled");
      setShowDisable(false);
      setPassword("");
      setCode("");
    } catch (cause) {
      setError(apiErrorMessage(cause, "No se pudo desactivar MFA."));
    } finally {
      setBusy(false);
    }
  }

  if (status === "loading") return <p className="text-body-sm text-muted-foreground">Cargando seguridad…</p>;
  if (status === "unavailable") return <p className="text-body-sm text-muted-foreground">La configuración de seguridad estará disponible cuando la sesión esté conectada.</p>;

  return <div className="space-y-4">
    {status === "disabled" && !setup && !skipped && <>
      <p className="text-body-sm text-muted-foreground">MFA es opcional. Actívalo para proteger los inicios de sesión y las operaciones sensibles.</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={() => void startSetup()} disabled={busy}>{busy ? "Preparando…" : "Configurar ahora"}</Button>
        <Button type="button" variant="outline" onClick={() => setSkipped(true)} disabled={busy}>Continuar sin MFA</Button>
      </div>
    </>}
    {status === "disabled" && skipped && <p className="text-body-sm text-muted-foreground">Continuarás sin MFA. Puedes configurarlo después desde Seguridad.</p>}
    {setup && <div className="grid gap-5 sm:grid-cols-[auto_1fr]">
      <div className="rounded-md border border-border bg-white p-3"><QRCodeSVG value={setup.otpauthUri} size={compact ? 160 : 220} title="Código QR para configurar MFA" marginSize={4} /></div>
      <div className="space-y-4">
        <p className="text-body-sm">Escanea el código con Authy, Google Authenticator, Microsoft Authenticator u otra aplicación compatible.</p>
        <div><p className="text-caption font-semibold">Clave manual</p><code className="break-all text-body-sm">{setup.secret}</code></div>
        <form onSubmit={verifySetup} className="space-y-3" aria-describedby={error ? "mfa-error" : undefined}>
          <label htmlFor="mfa-code" className="block text-body-sm font-semibold">Código de seis dígitos</label>
          <Input id="mfa-code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value)} required />
          <Button type="submit" disabled={busy}>{busy ? "Verificando…" : "Activar MFA"}</Button>
        </form>
      </div>
    </div>}
    {status === "active" && !setup && !showDisable && <div className="space-y-3">
      <p role="status" aria-live="polite" className="text-body-sm text-success">MFA está activo y se solicitará después de la contraseña en cada inicio de sesión.</p>
      <p className="text-caption text-muted-foreground">Si pierdes tu autenticador, necesitarás soporte para restablecerlo.</p>
      <Button type="button" variant="outline" onClick={() => setShowDisable(true)} disabled={busy}>Desactivar MFA</Button>
    </div>}
    {status === "active" && !setup && showDisable && <form onSubmit={disable} className="space-y-3" aria-describedby={error ? "mfa-error" : undefined}>
      <p className="text-body-sm text-muted-foreground">Para desactivar MFA, confirma tu contraseña y el código actual.</p>
      <label htmlFor="mfa-password" className="block text-body-sm font-semibold">Contraseña actual</label>
      <Input id="mfa-password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
      <label htmlFor="mfa-disable-code" className="block text-body-sm font-semibold">Código actual</label>
      <Input id="mfa-disable-code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value)} required />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="outline" disabled={busy}>{busy ? "Desactivando…" : "Desactivar MFA"}</Button>
        <Button type="button" variant="ghost" onClick={() => { setShowDisable(false); setPassword(""); setCode(""); }} disabled={busy}>Cancelar</Button>
      </div>
    </form>}
    {error && <p id="mfa-error" role="alert" aria-live="polite" className="text-body-sm text-destructive">{error}</p>}
  </div>;
}
