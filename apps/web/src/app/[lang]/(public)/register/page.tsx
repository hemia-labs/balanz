import { notFound } from "next/navigation";
import { RegisterForm } from "@/components/register-form";
import { getDictionary, isLocale } from "@/lib/i18n";

export default async function RegisterPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();

  return <RegisterForm locale={lang} dictionary={getDictionary(lang)} />;
}
