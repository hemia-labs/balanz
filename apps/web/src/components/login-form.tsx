"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Mail } from "lucide-react";
import { AuthFrame } from "@/components/auth-frame";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import type { Dictionary, Locale } from "@/lib/i18n";
import { apiErrorMessage } from "@/lib/api-client";
import { completeMfa, login } from "@/features/auth/api";
import { safeInternalReturnTo } from "@/lib/navigation-security";
import { useState } from "react";

export function LoginForm({
  locale,
  dictionary,
  returnTo,
}: {
  locale: Locale;
  dictionary: Dictionary;
  returnTo?: string;
}) {
  const { auth } = dictionary;
  const router = useRouter();
  const [requiresMfa, setRequiresMfa] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const destination = safeInternalReturnTo(returnTo);
  const organizationStep = `/${locale}/select-organization${destination ? `?returnTo=${encodeURIComponent(destination)}` : ""}`;

  function backToLogin() {
    setRequiresMfa(false);
    setCode("");
    setError("");
  }

  return (
    <AuthFrame
      locale={locale}
      eyebrow={auth.accessEyebrow}
      systemTitle={auth.systemTitle}
      systemDescription={auth.systemDescription}
      title={requiresMfa ? "Verificación en dos pasos" : auth.loginTitle}
      description={requiresMfa ? "Abre tu app de autenticación e introduce el código de 6 dígitos que se muestra." : auth.loginDescription}
      requiredHint={auth.requiredHint}
      contentClassName="max-w-md"
      centered
      footer={requiresMfa ? (
        <div className="flex flex-col items-center gap-3 text-center">
          <Button type="button" variant="ghost" size="sm" className="h-auto min-h-0 p-0 font-normal text-muted-foreground hover:bg-transparent hover:text-foreground" onClick={backToLogin}>
            ← Volver a inicio de sesión
          </Button>
        </div>
      ) : (
        <p className="text-center">
          {auth.noAccount}{" "}
          <Link
            href={"/" + locale + "/register"}
            className="inline-flex min-h-10 items-center font-semibold text-primary underline-offset-4 hover:underline"
          >
            {auth.register}
          </Link>
        </p>
      )}
    >
      <form onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError("");
        const form = new FormData(event.currentTarget);
        try {
          if (requiresMfa) {
            if (code.length !== 6) {
              setError("Ingresa el código de 6 dígitos.");
              return;
            }
            await completeMfa(code);
            router.replace(organizationStep);
          } else {
            const result = await login({ email: String(form.get("email") ?? ""), password: String(form.get("password") ?? "") });
            if (result.requiresMfa) setRequiresMfa(true);
            else router.replace(organizationStep);
          }
        } catch (cause) {
          setError(apiErrorMessage(cause, "No se pudo iniciar sesión."));
        } finally {
          setBusy(false);
        }
      }} className="space-y-4" aria-describedby={error ? "login-error" : undefined}>
        {requiresMfa ? (
          <InputOTP
            maxLength={6}
            value={code}
            onChange={setCode}
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="one-time-code"
            aria-label="Código de verificación de 6 dígitos"
          >
            <InputOTPGroup className="w-full justify-between gap-2">
              {Array.from({ length: 6 }, (_, index) => (
                <InputOTPSlot key={index} index={index} className="size-12 rounded-md border text-heading-sm" />
              ))}
            </InputOTPGroup>
          </InputOTP>
        ) : (
        <div className="space-y-4">
        <div className="space-y-2">
          <label htmlFor="email" className="block text-body-sm font-semibold">
            {auth.email}
          </label>
          <div className="relative">
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder={auth.emailPlaceholder}
              aria-describedby="email-help"
              className="pr-10"
              required
            />
            <Mail className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          </div>
          <p id="email-help" className="sr-only">
            {auth.emailHelp}
          </p>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <label htmlFor="password" className="block text-body-sm font-semibold">
              {auth.password}
            </label>
            <Link
              href={"/" + locale + "/forgot-password"}
              className="text-caption font-semibold text-primary underline-offset-4 hover:underline"
            >
              {auth.forgotPassword}
            </Link>
          </div>
          <div className="relative">
            <Input
              id="password"
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              placeholder={auth.passwordPlaceholder}
              aria-describedby="password-help"
              className="pr-10"
              required
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="absolute right-1 top-1"
              aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
              aria-pressed={showPassword}
              onClick={() => setShowPassword((visible) => !visible)}
            >
              {showPassword ? <EyeOff /> : <Eye />}
            </Button>
          </div>
          <p id="password-help" className="sr-only">
            {auth.passwordHelp}
          </p>
        </div>

        <div className="flex flex-col gap-2 text-body-sm sm:flex-row sm:items-center sm:justify-between">
          <label className="flex min-h-10 items-center gap-2 text-muted-foreground">
            <input
              type="checkbox"
              name="remember"
              className="size-5 rounded-sm border-input accent-primary"
            />
            {auth.remember}
          </label>
        </div>
        </div>
        )}

        <Button type="submit" className="w-full bg-[#0f5f68] hover:bg-[#0f5f68]/90" disabled={busy || (requiresMfa && code.length !== 6)}>
          {requiresMfa ? "Verificar código" : auth.submit}
        </Button>
        {error && <p id="login-error" role="alert" aria-live="polite" className="text-center text-body-sm text-destructive">{error}</p>}
      </form>
    </AuthFrame>
  );
}
