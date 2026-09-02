import { notFound } from "next/navigation";
import { PersonalScreen } from "@/components/personal-screen";

const personalSections: Record<string, string> = {
  profile: "profile",
  security: "security",
  preferences: "preferences",
  authorization: "authorization",
  help: "help",
  perfil: "profile",
  seguridad: "security",
  preferencias: "preferences",
  acceso: "authorization",
  ayuda: "help",
};

export default async function LegacyOrPersonalPage({
  params,
}: {
  params: Promise<{ lang: string; section: string }>;
}) {
  const { section } = await params;
  const personalSection = personalSections[section];
  if (personalSection) return <PersonalScreen section={personalSection} />;
  notFound();
}
