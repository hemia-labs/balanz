import { AppSidebar } from "@/components/app-sidebar";
import { AppTopbar } from "@/components/app-topbar";
import { getDictionary, isLocale } from "@/lib/i18n";
import { notFound } from "next/navigation";

export default async function PrivateLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode;
  params: Promise<{ lang: string }>;
}>) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();

  const dictionary = getDictionary(lang);

  return (
    <div className="flex min-h-screen w-full flex-1">
      <AppSidebar locale={lang} dictionary={dictionary} />
      <div className="flex min-w-0 flex-1 flex-col">
        <AppTopbar locale={lang} dictionary={dictionary} />
        <main className="flex-1 p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
