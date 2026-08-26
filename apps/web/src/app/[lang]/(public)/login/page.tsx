import { notFound } from "next/navigation";
import { LoginForm } from "@/components/login-form";
import { getDictionary, isLocale } from "@/lib/i18n";

export default async function LoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const { lang } = await params;
  const { returnTo } = await searchParams;
  if (!isLocale(lang)) notFound();

  return <LoginForm locale={lang} dictionary={getDictionary(lang)} returnTo={returnTo} />;
}
