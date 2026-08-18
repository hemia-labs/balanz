"use client";

import Link from "next/link";
import { AuthFrame } from "@/components/auth-frame";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Dictionary, Locale } from "@/lib/i18n";

export function RegisterForm({
  locale,
  dictionary,
}: {
  locale: Locale;
  dictionary: Dictionary;
}) {
  const { auth } = dictionary;

  return (
    <AuthFrame
      locale={locale}
      eyebrow={auth.accessEyebrow}
      systemTitle={auth.systemTitle}
      systemDescription={auth.systemDescription}
      title={auth.registerTitle}
      description={auth.registerDescription}
      requiredHint={auth.requiredHint}
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
      <form onSubmit={(event) => event.preventDefault()} className="space-y-5">
        <div className="space-y-2">
          <label htmlFor="full-name" className="block text-body-sm font-semibold">
            {auth.fullName}
          </label>
          <Input
            id="full-name"
            name="fullName"
            type="text"
            autoComplete="name"
            placeholder={auth.fullNamePlaceholder}
            required
          />
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
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            placeholder={auth.passwordPlaceholder}
            aria-describedby="register-password-help"
            required
            minLength={8}
          />
          <p id="register-password-help" className="text-caption text-muted-foreground">
            {auth.passwordHelp}
          </p>
        </div>

        <div className="space-y-2">
          <label htmlFor="confirm-password" className="block text-body-sm font-semibold">
            {auth.confirmPassword}
          </label>
          <Input
            id="confirm-password"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            placeholder={auth.confirmPasswordPlaceholder}
            required
            minLength={8}
          />
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

        <Button type="submit" className="w-full">
          {auth.registerSubmit}
        </Button>
      </form>
    </AuthFrame>
  );
}
