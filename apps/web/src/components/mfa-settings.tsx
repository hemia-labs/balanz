"use client";

import { CheckCircle2, Copy, Eye, EyeOff, KeyRound, ShieldCheck, ShieldOff, Smartphone } from "lucide-react";
import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { apiErrorMessage } from "@/lib/api-client";
import { disableTotp, setupTotp, verifyTotp } from "@/features/auth/api";
import { getSession } from "@/features/session/api";

type MfaStatus = "disabled" | "pending" | "active";
type SetupResponse = { factorId: string; secret: string; otpauthUri: string; status: "pending" };

function formatSecret(secret: string) {
  return secret.match(/.{1,4}/g)?.join(" ") ?? secret;
}

export function MfaSettings({
  compact = false,
  initialStatus,
  startOnMount = false,
  onActivated,
  onDisabled,
  onContinue,
  onCancel,
}: {
  compact?: boolean;
  initialStatus?: MfaStatus;
  startOnMount?: boolean;
  onActivated?: () => void;
  onDisabled?: () => void;
  onContinue?: () => void;
  onCancel?: () => void;
}) {
  const [status, setStatus] = useState<MfaStatus | "loading" | "unavailable">(initialStatus ?? "loading");
  const [setup, setSetup] = useState<SetupResponse | null>(null);
  const [code, setCode] = useState("");
  const [setupCode, setSetupCode] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showDisable, setShowDisable] = useState(false);
  const [setupDismissed, setSetupDismissed] = useState(false);

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
    setSetupDismissed(false);
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

  useEffect(() => {
    if (!startOnMount || setupDismissed || status === "loading" || status === "unavailable" || status === "active" || setup) return;
    let active = true;
    void setupTotp()
      .then((next) => {
        if (!active) return;
        setSetup(next);
        setStatus("pending");
      })
      .catch((cause) => {
        if (active) setError(apiErrorMessage(cause, "No se pudo iniciar la configuración."));
      });
    return () => { active = false; };
  }, [setup, setupDismissed, startOnMount, status]);

  async function verifySetup(event: React.FormEvent) {
    event.preventDefault();
    if (setupCode.length !== 6) return;
    setBusy(true);
    setError("");
    try {
      await verifyTotp(setupCode);
      setStatus("active");
      setSetup(null);
      setSetupDismissed(false);
      setSetupCode("");
      onActivated?.();
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
      setShowPassword(false);
      setCode("");
      onDisabled?.();
    } catch (cause) {
      setError(apiErrorMessage(cause, "No se pudo desactivar MFA."));
    } finally {
      setBusy(false);
    }
  }

  async function copySecret() {
    if (!setup) return;
    try {
      await navigator.clipboard.writeText(setup.secret);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setError("No se pudo copiar la clave. Puedes seleccionarla manualmente.");
    }
  }

  if (status === "loading") return <p className="text-body-sm text-muted-foreground">Cargando seguridad…</p>;
  if (status === "unavailable") return <p className="text-body-sm text-muted-foreground">La configuración de seguridad estará disponible cuando la sesión esté conectada.</p>;

  const active = status === "active";
  const pending = status === "pending";
  const setupSteps = setup && <div className="space-y-6">
    <div className="space-y-3">
      <div className="flex items-center gap-3"><span className="grid size-6 place-items-center rounded-full bg-primary text-caption font-bold text-primary-foreground">1</span><h2 className="text-body-lg font-semibold">Escanea el código QR</h2></div>
      <p className="text-body-sm text-muted-foreground">Abre tu aplicación autenticadora y escanea este código.</p>
      <div className="grid gap-4 sm:grid-cols-[11rem_1fr] sm:items-center">
        <div className="w-fit rounded-lg border border-border bg-white p-2"><QRCodeSVG value={setup.otpauthUri} size={compact ? 128 : 160} title="Código QR para configurar MFA" marginSize={3} /></div>
        <div className="space-y-2">
          <p className="text-caption text-foreground">¿No puedes escanearlo? Ingresa esta clave manualmente:</p>
          <div className="flex items-center gap-2 rounded-md bg-muted px-3 py-2">
            <code className="min-w-0 flex-1 break-all text-caption font-semibold tracking-wide">{formatSecret(setup.secret)}</code>
            <Button type="button" variant="ghost" size="xs" onClick={() => void copySecret()} aria-label="Copiar clave manual">{copied ? "Copiado" : <><Copy aria-hidden="true" /> Copiar</>}</Button>
          </div>
        </div>
      </div>
    </div>
    <div className="border-t border-border pt-5">
      <div className="flex items-center gap-3"><span className="grid size-6 place-items-center rounded-full bg-primary text-caption font-bold text-primary-foreground">2</span><h2 className="text-body-lg font-semibold">Confirma el código</h2></div>
      <p className="mt-3 text-body-sm text-muted-foreground">Escribe los 6 dígitos que muestra tu aplicación para terminar la activación.</p>
      <form onSubmit={verifySetup} className="mt-4 space-y-4" aria-describedby={error ? "mfa-error" : undefined}>
        <InputOTP maxLength={6} value={setupCode} onChange={setSetupCode} inputMode="numeric" pattern="[0-9]*" aria-label="Código de verificación de 6 dígitos">
          <InputOTPGroup className="w-full max-w-sm justify-between gap-2">
            {Array.from({ length: 6 }, (_, index) => <InputOTPSlot key={index} index={index} className="size-11 rounded-md border text-heading-sm sm:size-12" />)}
          </InputOTPGroup>
        </InputOTP>
        <p className="text-caption text-muted-foreground">El código se actualiza cada 30 segundos.</p>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={() => { setSetup(null); setSetupCode(""); setError(""); setStatus("disabled"); setSetupDismissed(true); onCancel?.(); }} disabled={busy}>Cancelar</Button>
          <Button type="submit" disabled={busy || setupCode.length !== 6}>{busy ? "Verificando…" : "Verificar y activar"}</Button>
        </div>
      </form>
    </div>
  </div>;

  return <div className="space-y-5">
    {!compact && !setup && !showDisable && <Card className="gap-0 border border-border py-0 ring-0">
      <CardHeader className="gap-5 p-5 sm:grid-cols-[1fr_auto] sm:items-center">
        <div className="flex min-w-0 gap-4">
          <span className={`grid size-12 shrink-0 place-items-center rounded-lg ${active ? "bg-success-surface text-success" : "bg-muted text-muted-foreground"}`}>
            {active ? <ShieldCheck className="size-6" aria-hidden="true" /> : <ShieldOff className="size-6" aria-hidden="true" />}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="text-body-lg font-semibold"><h2>Autenticación de dos factores</h2></CardTitle>
              <Badge variant={active ? "success" : pending ? "info" : "outline"}>
                {active ? "Activa" : pending ? "Configuración pendiente" : "Desactivada"}
              </Badge>
            </div>
            <CardDescription role="status" aria-live="polite" className="mt-1 max-w-xl text-body-sm">
              {active
                ? "Tu cuenta solicita un código temporal además de tu contraseña al iniciar sesión."
                : "Añade un código temporal a tu inicio de sesión para reducir el riesgo de accesos no autorizados."}
            </CardDescription>
          </div>
        </div>
        {active ? (
          <Button type="button" variant="outline" onClick={() => { setError(""); setShowPassword(false); setShowDisable(true); }}>
            <ShieldOff aria-hidden="true" /> Desactivar MFA
          </Button>
        ) : (
          <Button type="button" onClick={() => void startSetup()} disabled={busy}>
            <ShieldCheck aria-hidden="true" /> {busy ? "Preparando…" : pending ? "Continuar configuración" : "Activar MFA"}
          </Button>
        )}
      </CardHeader>
      <CardContent className="border-t border-border p-0">
      <div className="grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2">
        <div className="flex gap-3 bg-card p-4">
          <Smartphone className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
          <div><p className="text-body-sm font-semibold">Aplicación autenticadora</p><p className="mt-1 text-caption text-muted-foreground">Compatible con cualquier aplicación TOTP.</p></div>
        </div>
        <div className="flex gap-3 bg-card p-4">
          <KeyRound className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
          <div><p className="text-body-sm font-semibold">Protección al iniciar sesión</p><p className="mt-1 text-caption text-muted-foreground">El código cambia cada 30 segundos.</p></div>
        </div>
      </div>
      </CardContent>
    </Card>}

    {compact && !setup && !active && <div className="space-y-4">
      <p className="text-body-sm text-muted-foreground">Puedes activar MFA ahora o continuar sin activarlo y configurarlo más tarde desde Seguridad.</p>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={onContinue} disabled={!onContinue}>Continuar sin activar</Button>
        <Button type="button" onClick={() => void startSetup()} disabled={busy}>{busy ? "Preparando…" : "Mostrar QR de nuevo"}</Button>
      </div>
    </div>}

    {setup && (compact ? setupSteps : <Card className="gap-0 border border-border py-0 ring-0"><CardHeader className="border-b p-5"><CardTitle><h2>Configura la autenticación de dos factores</h2></CardTitle><CardDescription>Vincula una aplicación autenticadora en dos pasos.</CardDescription></CardHeader><CardContent className="p-5">{setupSteps}</CardContent></Card>)}

    {compact && active && !setup && !showDisable && <div className="space-y-4">
      <div className="flex gap-3 rounded-lg border border-success/30 bg-success-surface p-4"><CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" aria-hidden="true" /><div><p role="status" aria-live="polite" className="text-body-sm font-semibold text-success">Verificación en dos pasos activada</p><p className="mt-1 text-body-sm text-muted-foreground">Tu cuenta ya tiene una capa adicional de protección.</p></div></div>
      <p className="text-caption text-muted-foreground">Si pierdes el acceso a tu autenticador, necesitarás soporte para restablecerlo.</p>
      {onContinue && <div className="flex justify-end"><Button type="button" onClick={onContinue}>Continuar a la aplicación</Button></div>}
    </div>}

    {!compact && active && !setup && showDisable && <form onSubmit={disable} aria-describedby={error ? "mfa-error" : undefined} className="mx-auto w-full max-w-xl"><Card className="gap-0 border border-destructive/30 py-0 ring-0">
      <CardHeader className="grid-cols-[auto_1fr] gap-x-3 bg-destructive-surface/45 p-5">
        <ShieldOff className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden="true" />
        <div><CardTitle className="text-body-lg font-semibold"><h2>Desactivar autenticación de dos factores</h2></CardTitle><CardDescription className="mt-1 text-body-sm">Tu cuenta volverá a depender únicamente de la contraseña. Confirma esta acción con tus credenciales actuales.</CardDescription></div>
      </CardHeader>
      <CardContent className="p-5">
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <label htmlFor="mfa-password" className="text-body-sm font-semibold">Contraseña actual</label>
            <div className="relative">
              <Input id="mfa-password" type={showPassword ? "text" : "password"} autoComplete="current-password" className="pr-10" value={password} onChange={(event) => setPassword(event.target.value)} required />
              <Button type="button" variant="ghost" size="icon-xs" className="absolute right-1 top-1" aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"} aria-pressed={showPassword} onClick={() => setShowPassword((visible) => !visible)}>
                {showPassword ? <EyeOff /> : <Eye />}
              </Button>
            </div>
          </div>
          <div className="grid gap-1.5">
            <span className="text-body-sm font-semibold">Código actual</span>
            <InputOTP maxLength={6} value={code} onChange={setCode} inputMode="numeric" pattern="[0-9]*" autoComplete="one-time-code" aria-label="Código actual de 6 dígitos">
              <InputOTPGroup className="w-full max-w-sm justify-between gap-2">
                {Array.from({ length: 6 }, (_, index) => <InputOTPSlot key={index} index={index} className="size-11 rounded-md border text-heading-sm sm:size-12" />)}
              </InputOTPGroup>
            </InputOTP>
          </div>
        </div>
      </CardContent>
      <CardFooter className="flex-col-reverse items-stretch gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={() => { setShowDisable(false); setPassword(""); setShowPassword(false); setCode(""); setError(""); }} disabled={busy}>Cancelar</Button>
        <Button type="submit" variant="destructive" disabled={busy || !password || code.length !== 6}>{busy ? "Desactivando…" : "Confirmar desactivación"}</Button>
      </CardFooter>
    </Card></form>}

    {error && <p id="mfa-error" role="alert" aria-live="polite" className="rounded-md border border-destructive/30 bg-destructive-surface px-3 py-2 text-body-sm text-destructive">{error}</p>}
  </div>;
}
