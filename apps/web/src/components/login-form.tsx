"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { AuthFrame } from "@/components/auth-frame";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Dictionary, Locale } from "@/lib/i18n";

export function LoginForm({
  locale,
  dictionary,
}: {
  locale: Locale;
  dictionary: Dictionary;
}) {
  const { auth } = dictionary;
  const router = useRouter();

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
      <form onSubmit={(event) => { event.preventDefault(); router.push("/es/seleccionar-despacho"); }} className="space-y-5">
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

        <Button type="submit" className="w-full">
          {auth.submit}
        </Button>
        <p className="text-center text-caption text-muted-foreground">Acceso demostrativo: no valida ni guarda credenciales.</p>
      </form>
    </AuthFrame>
  );
}
