import { notFound, redirect } from "next/navigation";
import { PersonalScreen } from "@/components/personal-screen";
import { demoOrganizationId } from "@/lib/demo-data";
import { resolveLegacyDestination } from "@/lib/navigation-core";

const personalSections = new Set(["perfil", "seguridad", "preferencias", "ayuda"]);

export default async function LegacyOrPersonalPage({ params }: { params: Promise<{ lang: string; section: string }> }) {
  const { lang, section } = await params;
  if (lang !== "es") redirect(`/es/${section}`);
  if (personalSections.has(section)) return <PersonalScreen section={section} />;
  const destination = resolveLegacyDestination(section);
  if (!destination) notFound();
  redirect(`/es/despachos/${demoOrganizationId}/${destination}?origen=${encodeURIComponent(section)}`);
}
