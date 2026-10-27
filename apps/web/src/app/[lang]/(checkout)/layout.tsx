import { Suspense } from "react";
import { SessionProvider } from "@/features/session/session-provider";
import { AccountingContextProvider } from "@/components/accounting-context";

export default function CheckoutLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Suspense
      fallback={
        <div
          role="status"
          aria-busy="true"
          className="mx-auto w-full max-w-2xl space-y-6 px-4 py-6"
        >
          <span className="sr-only">Cargando contratación</span>
          <div
            aria-hidden="true"
            className="h-8 w-56 animate-pulse rounded bg-muted motion-reduce:animate-none"
          />
          <div
            aria-hidden="true"
            className="h-48 animate-pulse rounded-lg bg-muted motion-reduce:animate-none"
          />
        </div>
      }
    >
      <SessionProvider>
        <AccountingContextProvider>{children}</AccountingContextProvider>
      </SessionProvider>
    </Suspense>
  );
}
