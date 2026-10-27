import { notFound } from "next/navigation";
import { ForgotPasswordForm } from "@/components/forgot-password-form";
import { getDictionary, isLocale } from "@/lib/i18n";

export default async function ForgotPasswordPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  return <ForgotPasswordForm locale={lang} dictionary={getDictionary(lang)} />;
}
