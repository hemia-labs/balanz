import { EmailVerification } from "@/components/email-verification";

export default async function VerifyEmailPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  return <EmailVerification locale={lang} />;
}

