"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { AuthFrame } from "@/components/auth-frame";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Dictionary, Locale } from "@/lib/i18n";
import { ApiError } from "@/lib/api-client";
import { register } from "@/features/auth/api";
import { slugifyOrganization, type RegisterPayload } from "@/features/session/types";

export function RegisterForm({
  locale,
  dictionary,
}: {
  locale: Locale;
  dictionary: Dictionary;
}) {
  const { auth } = dictionary;
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <AuthFrame
      locale={locale}
      eyebrow={auth.accessEyebrow}
      systemTitle={auth.systemTitle}
      systemDescription={auth.systemDescription}
      title={auth.registerTitle}
      description={auth.registerDescription}
      requiredHint={auth.requiredHint}
      contentClassName="max-w-lg"
      footer={
        <p className="text-center">
          {auth.hasAccount}{" "}
          <Link
            href={"/" + locale + "/login"}
            className="inline-flex min-h-10 items-center font-semibold text-primary underline-offset-4 hover:underline"
          >
            {auth.login}
          </Link>
        </p>
      }
    >
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setError(null);
          const form = new FormData(event.currentTarget);
          const password = String(form.get("password") ?? "");
          const confirmPassword = String(form.get("confirmPassword") ?? "");
          if (password !== confirmPassword) {
            setError("Las contraseñas no coinciden.");
            return;
          }
          const organizationName = String(form.get("organizationName") ?? "").trim();
          const payload: RegisterPayload = {
            firstName: String(form.get("firstName") ?? "").trim(),
            lastName: String(form.get("lastName") ?? "").trim(),
            email: String(form.get("email") ?? "").trim().toLowerCase(),
            password,
            organizationName,
            slug: slugifyOrganization(organizationName),
            subscriptionType: "trial",
          };
          setSubmitting(true);
          try {
            const response = await register(payload);
            sessionStorage.setItem("balanz_pending_registration", JSON.stringify({
              email: payload.email,
              organizationName: payload.organizationName,
              subscriptionType: response.subscriptionType,
            }));
            router.push("/verify-email");
          } catch (requestError) {
            setError(requestError instanceof ApiError ? requestError.message : "No se pudo crear la organización.");
          } finally {
            setSubmitting(false);
          }
        }}
        className="space-y-5"
        aria-describedby={error ? "register-error" : undefined}
      >
        {error ? <p id="register-error" role="alert" aria-live="polite" className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-body-sm text-destructive">{error}</p> : null}
        <div className="grid gap-5 sm:grid-cols-2 sm:gap-4">
        <div className="space-y-2">
          <label htmlFor="first-name" className="block text-body-sm font-semibold">
            Nombre
          </label>
          <Input
            id="first-name"
            name="firstName"
            type="text"
            autoComplete="given-name"
            placeholder="Cristian"
            required
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="last-name" className="block text-body-sm font-semibold">Apellidos</label>
          <Input id="last-name" name="lastName" type="text" autoComplete="family-name" placeholder="Méndez" required />
        </div>
        </div>

        <div className="space-y-2">
          <label htmlFor="organization-name" className="block text-body-sm font-semibold">Nombre de la organización</label>
          <Input id="organization-name" name="organizationName" type="text" autoComplete="organization" placeholder="Estudio contable" maxLength={160} required />
        </div>

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
            aria-describedby="register-email-help"
            required
          />
          <p id="register-email-help" className="text-caption text-muted-foreground">
            {auth.emailHelp}
          </p>
        </div>

        <div className="space-y-2">
          <label htmlFor="password" className="block text-body-sm font-semibold">
            {auth.password}
          </label>
          <div className="relative">
            <Input
              id="password"
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              placeholder={auth.passwordPlaceholder}
              aria-describedby="register-password-help"
              required
              minLength={8}
              className="pr-12"
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
          <p id="register-password-help" className="text-caption text-muted-foreground">
            {auth.passwordHelp}
          </p>
        </div>

        <div className="space-y-2">
          <label htmlFor="confirm-password" className="block text-body-sm font-semibold">
            {auth.confirmPassword}
          </label>
          <div className="relative">
            <Input
              id="confirm-password"
              name="confirmPassword"
              type={showConfirmPassword ? "text" : "password"}
              autoComplete="new-password"
              placeholder={auth.confirmPasswordPlaceholder}
              required
              minLength={8}
              className="pr-12"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="absolute right-1 top-1"
              aria-label={showConfirmPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
              aria-pressed={showConfirmPassword}
              onClick={() => setShowConfirmPassword((visible) => !visible)}
            >
              {showConfirmPassword ? <EyeOff /> : <Eye />}
            </Button>
          </div>
        </div>

        <label className="flex min-h-10 items-start gap-2 text-body-sm text-muted-foreground">
          <input
            type="checkbox"
            name="terms"
            required
            className="mt-2 size-5 rounded-sm border-input accent-primary"
          />
          <span className="pt-2">{auth.acceptTerms}</span>
        </label>

        <Button type="submit" className="w-full" disabled={submitting} aria-busy={submitting}>
          {submitting ? "Creando organización…" : auth.registerSubmit}
        </Button>
        <p className="text-center text-caption text-muted-foreground">Incluye una prueba gratuita. Podrás configurar la facturación después.</p>
      </form>
    </AuthFrame>
  );
}
