"use client";

import Link from "next/link";
import { FileText } from "lucide-react";
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
    <main className="flex min-h-[100dvh] w-full items-center justify-center px-6 py-12">
      <div className="mx-auto w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="grid size-10 place-items-center rounded-xl bg-primary text-primary-foreground">
            <FileText className="size-5" />
          </div>
          <p className="mt-3 text-sm font-semibold tracking-tight">balanz</p>
          <h1 className="mt-8 text-2xl font-semibold tracking-tight">{auth.registerTitle}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{auth.registerDescription}</p>
        </div>

        <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
          <form onSubmit={(event) => event.preventDefault()} className="space-y-5">
            <div className="space-y-2">
              <label htmlFor="full-name" className="text-sm font-medium">
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
              <label htmlFor="email" className="text-sm font-medium">
                {auth.email}
              </label>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                placeholder={auth.emailPlaceholder}
                required
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="password" className="text-sm font-medium">
                {auth.password}
              </label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="new-password"
                placeholder={auth.passwordPlaceholder}
                required
                minLength={8}
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="confirm-password" className="text-sm font-medium">
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

            <label className="flex items-start gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                name="terms"
                required
                className="mt-0.5 size-4 rounded border-input accent-primary"
              />
              <span>{auth.acceptTerms}</span>
            </label>

            <Button type="submit" size="lg" className="h-10 w-full">
              {auth.registerSubmit}
            </Button>
          </form>
        </div>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          {auth.hasAccount}{" "}
          <Link href={`/${locale}/login`} className="font-medium text-foreground underline-offset-4 hover:underline">
            {auth.login}
          </Link>
        </p>
      </div>
    </main>
  );
}
