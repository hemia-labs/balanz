import { AppShell } from "@/components/app-shell";
import { AccountingContextProvider } from "@/components/accounting-context";
import { SessionProvider } from "@/features/session/session-provider";
import { isLocale } from "@/lib/i18n";
import { notFound } from "next/navigation";
import { Suspense } from "react";

export default async function PrivateLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode;
  params: Promise<{ lang: string }>;
}>) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();

  return (
    <Suspense fallback={<div className="grid min-h-screen flex-1 place-items-center text-body-sm text-muted-foreground">Cargando contexto seguro…</div>}>
      <SessionProvider>
        <AccountingContextProvider>
          <AppShell>
            <main
              id="main-content"
              tabIndex={-1}
              className="flex-1 px-4 py-6 focus:outline-none sm:px-6 sm:py-8 lg:px-8"
            >
              <div className="mx-auto w-full max-w-content">{children}</div>
            </main>
          </AppShell>
        </AccountingContextProvider>
      </SessionProvider>
    </Suspense>
  );
}
