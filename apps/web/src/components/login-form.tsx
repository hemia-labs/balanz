"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { AuthFrame } from "@/components/auth-frame";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  const destination = safeInternalReturnTo(returnTo);

  return (
    <AuthFrame
      locale={locale}
      eyebrow={auth.accessEyebrow}
      systemTitle={auth.systemTitle}
      systemDescription={auth.systemDescription}
      title={auth.loginTitle}
      description={auth.loginDescription}
      requiredHint={auth.requiredHint}
      footer={
        <p className="text-center">
          {auth.noAccount}{" "}
          <Link
            href={"/" + locale + "/register"}
            className="inline-flex min-h-10 items-center font-semibold text-primary underline-offset-4 hover:underline"
          >
            {auth.register}
          </Link>
        </p>
      }
    >
      <form onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError("");
        const form = new FormData(event.currentTarget);
        try {
          if (requiresMfa) {
            await completeMfa(code);
            router.push(destination ?? `/${locale}/select-organization`);
          } else {
            const result = await login({ email: String(form.get("email") ?? ""), password: String(form.get("password") ?? "") });
            if (result.requiresMfa) setRequiresMfa(true);
            else router.push(destination ?? `/${locale}/select-organization`);
          }
        } catch (cause) {
          setError(apiErrorMessage(cause, "No se pudo iniciar sesión."));
        } finally {
          setBusy(false);
        }
      }} className="space-y-5" aria-describedby={error ? "login-error" : undefined}>
        <div className="space-y-2">
          <label htmlFor="email" className="block text-body-sm font-semibold">
            {auth.email}
          </label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder={auth.emailPlaceholder}
            aria-describedby="email-help"
            required
          />
          <p id="email-help" className="text-caption text-muted-foreground">
            {auth.emailHelp}
          </p>
        </div>

        <div className="space-y-2">
          <label htmlFor="password" className="block text-body-sm font-semibold">
            {auth.password}
          </label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            placeholder={auth.passwordPlaceholder}
            aria-describedby="password-help"
            required
          />
          <p id="password-help" className="text-caption text-muted-foreground">
            {auth.passwordHelp}
          </p>
        </div>

        {requiresMfa && <div className="space-y-2">
          <label htmlFor="login-mfa-code" className="block text-body-sm font-semibold">Código MFA</label>
          <Input id="login-mfa-code" name="mfaCode" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value)} required />
          <p className="text-caption text-muted-foreground">Abre tu aplicación de autenticación para obtener el código.</p>
        </div>}

        <div className="flex flex-col gap-2 text-body-sm sm:flex-row sm:items-center sm:justify-between">
          <label className="flex min-h-10 items-center gap-2 text-muted-foreground">
            <input
              type="checkbox"
              name="remember"
              className="size-5 rounded-sm border-input accent-primary"
            />
            {auth.remember}
          </label>
          <Link
            href={"/" + locale + "/forgot-password"}
            className="inline-flex min-h-10 items-center font-semibold text-primary underline-offset-4 hover:underline"
          >
          {auth.forgotPassword}
          </Link>
        </div>

        <Button type="submit" className="w-full" disabled={busy}>
          {requiresMfa ? "Verificar código" : auth.submit}
        </Button>
        {error && <p id="login-error" role="alert" aria-live="polite" className="text-center text-body-sm text-destructive">{error}</p>}
      </form>
    </AuthFrame>
  );
}
