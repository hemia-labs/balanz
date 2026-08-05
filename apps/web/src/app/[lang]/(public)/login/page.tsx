import { notFound } from "next/navigation";
import { LoginForm } from "@/components/login-form";
import { getDictionary, isLocale } from "@/lib/i18n";

export default async function LoginPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();

  return <LoginForm locale={lang} dictionary={getDictionary(lang)} />;
}
