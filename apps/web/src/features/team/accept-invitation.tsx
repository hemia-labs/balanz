"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Surface } from "@/components/product-patterns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { isAbortError } from "@/lib/api-client";
import { acceptInvitation, type AcceptInvitationResult } from "./api";
import { readInvitationSecret, type InvitationSecret } from "./invitation-link";
import { teamErrorMessage } from "./team-errors";

export function AcceptInvitation({ locale = "es" }: { locale?: string }) {
  const [secret, setSecret] = useState<InvitationSecret | null>(null);
  const [linkReady, setLinkReady] = useState(false);
  const [hasAccount, setHasAccount] = useState(true);
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AcceptInvitationResult | null>(null);
  const request = useRef<AbortController | null>(null);

  useEffect(() => {
    const parsed = readInvitationSecret(window.location.hash);
    const timer = window.setTimeout(() => {
      setSecret(parsed);
      setLinkReady(true);
      if (window.location.hash) {
        window.history.replaceState(
          {},
          document.title,
          `${window.location.pathname}${window.location.search}`,
        );
      }
    }, 0);
    return () => {
      window.clearTimeout(timer);
      request.current?.abort();
    };
  }, []);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!secret || submitting) return;
    setSubmitting(true);
    setError(null);
    request.current?.abort();
    request.current = new AbortController();
    try {
      const accepted = await acceptInvitation(
        secret.invitationId,
        {
          token: secret.token,
          email,
          ...(hasAccount ? {} : { firstName, lastName, password }),
        },
        request.current.signal,
      );
      if (accepted.nextStep === "verify_email") {
        sessionStorage.setItem(
          "balanz_pending_registration",
          JSON.stringify({ email }),
        );
      }
      setResult(accepted);
      setSecret(null);
      setPassword("");
      setShowPassword(false);
    } catch (cause) {
      if (isAbortError(cause)) return;
      setError(
        teamErrorMessage(
          cause,
          "No pudimos aceptar la invitación. El enlace puede haber expirado o ya fue utilizado.",
        ),
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main
      id="main-content"
      className="grid min-h-screen w-full flex-1 place-items-center bg-background px-4 py-8"
    >
      <Surface className="w-full max-w-form space-y-5 p-6">
        <div>
          <p className="text-caption font-semibold text-accent-foreground">
            Acceso al despacho
          </p>
          <h1 className="mt-1 text-heading-lg font-bold">Aceptar invitación</h1>
          <p className="mt-2 text-body-sm text-muted-foreground">
            La invitación crea tu membresía. Las cuentas cliente y capacidades
            sensibles se asignan por separado.
          </p>
        </div>

        {!linkReady ? (
          <p role="status" aria-live="polite" className="text-body-sm">
            Validando enlace…
          </p>
        ) : result ? (
          <InvitationAccepted result={result} locale={locale} email={email} />
        ) : !secret ? (
          <div role="alert" className="space-y-4">
            <p className="text-body-sm text-destructive">
              El enlace no contiene una invitación válida. Solicita una nueva al
              administrador de tu despacho.
            </p>
            <Button
              render={<Link href={`/${locale}/login`} />}
              variant="outline"
            >
              Ir a iniciar sesión
            </Button>
          </div>
        ) : (
          <form className="space-y-5" onSubmit={submit}>
            <fieldset className="space-y-2">
              <legend className="text-body-sm font-semibold">
                ¿Ya tienes una cuenta en Balanz?
              </legend>
              <label className="flex items-center gap-2 text-body-sm">
                <input
                  type="radio"
                  name="account-kind"
                  checked={hasAccount}
                  onChange={() => setHasAccount(true)}
                />
                Sí, vincular mi cuenta
              </label>
              <label className="flex items-center gap-2 text-body-sm">
                <input
                  type="radio"
                  name="account-kind"
                  checked={!hasAccount}
                  onChange={() => setHasAccount(false)}
                />
                No, crear mi identidad
              </label>
            </fieldset>
            <label className="grid gap-2 text-body-sm font-semibold">
              Correo de la invitación
              <Input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? "accept-invitation-error" : undefined}
              />
            </label>
            {!hasAccount ? (
              <div className="grid gap-5 sm:grid-cols-2">
                <label className="grid gap-2 text-body-sm font-semibold">
                  Nombre
                  <Input
                    required
                    autoComplete="given-name"
                    value={firstName}
                    onChange={(event) => setFirstName(event.target.value)}
                  />
                </label>
                <label className="grid gap-2 text-body-sm font-semibold">
                  Apellidos
                  <Input
                    required
                    autoComplete="family-name"
                    value={lastName}
                    onChange={(event) => setLastName(event.target.value)}
                  />
                </label>
                <div className="space-y-2 sm:col-span-2">
                  <label
                    htmlFor="invitation-password"
                    className="block text-body-sm font-semibold"
                  >
                    Contraseña
                  </label>
                  <div className="relative">
                    <Input
                      id="invitation-password"
                      type={showPassword ? "text" : "password"}
                      required
                      minLength={8}
                      autoComplete="new-password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      aria-describedby="invitation-password-help"
                      className="pr-12"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      className="absolute right-1 top-1"
                      aria-label={
                        showPassword
                          ? "Ocultar contraseña"
                          : "Mostrar contraseña"
                      }
                      aria-pressed={showPassword}
                      onClick={() => setShowPassword((visible) => !visible)}
                    >
                      {showPassword ? <EyeOff /> : <Eye />}
                    </Button>
                  </div>
                  <p
                    id="invitation-password-help"
                    className="text-caption text-muted-foreground"
                  >
                    Usa al menos 8 caracteres.
                  </p>
                </div>
              </div>
            ) : null}
            {error ? (
              <p
                id="accept-invitation-error"
                role="alert"
                className="text-body-sm text-destructive"
              >
                {error}
              </p>
            ) : null}
            <Button
              className="w-full"
              type="submit"
              disabled={submitting}
              aria-busy={submitting}
            >
              {submitting ? "Aceptando…" : "Aceptar invitación"}
            </Button>
          </form>
        )}
      </Surface>
    </main>
  );
}

function InvitationAccepted({
  result,
  locale,
  email,
}: {
  result: AcceptInvitationResult;
  locale: string;
  email: string;
}) {
  const pending = result.membershipStatus === "pending";
  return (
    <div className="space-y-4" role="status" aria-live="polite">
      <p className="text-body-sm text-success">
        La invitación fue aceptada y no puede volver a utilizarse.
      </p>
      {pending ? (
        <p className="rounded-md border border-success/30 bg-success-surface p-3 text-body-sm text-success">
          Enviamos un correo de verificación a <strong>{email}</strong>. Abre el
          enlace para activar tu cuenta y poder iniciar sesión.
        </p>
      ) : null}
      <dl className="grid gap-2 rounded-md border border-border bg-muted/30 p-3 text-body-sm sm:grid-cols-2">
        <div>
          <dt className="text-muted-foreground">Membresía</dt>
          <dd className="font-semibold">{pending ? "Pendiente" : "Activa"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Siguiente paso</dt>
          <dd className="font-semibold">
            {result.nextStep === "verify_email"
              ? "Verificar correo y configurar MFA"
              : "Iniciar sesión y completar MFA si se solicita"}
          </dd>
        </div>
      </dl>
      <p className="text-body-sm text-muted-foreground">
        Aún no se ha concedido acceso a cuentas cliente ni a información fiscal.
      </p>
      <Button
        render={
          <Link
            href={pending ? `/${locale}/verify-email` : `/${locale}/login`}
          />
        }
        className="w-full"
      >
        {pending ? "Ir a verificar correo" : "Continuar a iniciar sesión"}
      </Button>
    </div>
  );
}
