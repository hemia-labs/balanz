"use client";

import Link from "next/link";
import { FileText } from "lucide-react";
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

  return (
    <main className="flex min-h-[100dvh] w-full items-center justify-center px-6 py-12">
      <div className="mx-auto w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="grid size-10 place-items-center rounded-xl bg-primary text-primary-foreground">
            <FileText className="size-5" />
          </div>
          <p className="mt-3 text-sm font-semibold tracking-tight">balanz</p>
          <h1 className="mt-8 text-2xl font-semibold tracking-tight">{auth.loginTitle}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{auth.loginDescription}</p>
        </div>

        <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
          <form onSubmit={(event) => event.preventDefault()} className="space-y-5">
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
                autoComplete="current-password"
                placeholder={auth.passwordPlaceholder}
                required
              />
            </div>

            <div className="flex items-center justify-between gap-4 text-sm">
              <label className="flex items-center gap-2 text-muted-foreground">
                <input
                  type="checkbox"
                  name="remember"
                  className="size-4 rounded border-input accent-primary"
                />
                {auth.remember}
              </label>
              <Link href={`/${locale}/forgot-password`} className="text-primary underline-offset-4 hover:underline">
                {auth.forgotPassword}
              </Link>
            </div>

            <Button type="submit" size="lg" className="h-10 w-full">
              {auth.submit}
            </Button>
          </form>
        </div>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          {auth.noAccount}{" "}
          <Link href={`/${locale}/register`} className="font-medium text-foreground underline-offset-4 hover:underline">
            {auth.register}
          </Link>
        </p>
      </div>
    </main>
  );
}
