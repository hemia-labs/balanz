import { notFound, redirect } from "next/navigation";
import { PersonalScreen } from "@/components/personal-screen";
import { resolveLegacyDestination } from "@/lib/navigation-core";

const personalSections: Record<string, string> = {
  profile: "profile",
  security: "security",
  preferences: "preferences",
  help: "help",
  perfil: "profile",
  seguridad: "security",
  preferencias: "preferences",
  ayuda: "help",
};

export default async function LegacyOrPersonalPage({
  params,
}: {
  params: Promise<{ lang: string; section: string }>;
}) {
  const { lang, section } = await params;
  const personalSection = personalSections[section];
  if (personalSection) return <PersonalScreen section={personalSection} />;
  const destination = resolveLegacyDestination(section);
  if (!destination) notFound();
  redirect(`/${lang}/`);
}
