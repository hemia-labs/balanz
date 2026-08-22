import { notFound, redirect } from "next/navigation";
import { PersonalScreen } from "@/components/personal-screen";
import { resolveLegacyDestination } from "@/lib/navigation-core";

const personalSections = new Set(["perfil", "seguridad", "preferencias", "ayuda"]);

export default async function LegacyOrPersonalPage({ params }: { params: Promise<{ lang: string; section: string }> }) {
  const { lang, section } = await params;
  if (personalSections.has(section)) return <PersonalScreen section={section} />;
  const destination = resolveLegacyDestination(section);
  if (!destination) notFound();
  redirect(`/${lang}/`);
}
