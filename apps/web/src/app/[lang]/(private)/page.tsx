import { redirect } from "next/navigation";
import { demoOrganizationId } from "@/lib/demo-data";

export default async function EntryPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  if (lang !== "es") redirect(`/es/despachos/${demoOrganizationId}/inicio`);
  redirect(`/es/despachos/${demoOrganizationId}/inicio`);
}
