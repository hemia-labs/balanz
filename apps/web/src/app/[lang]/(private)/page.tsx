import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { getDictionary, isLocale } from "@/lib/i18n";
import { LayoutDashboard } from "lucide-react";
import { notFound } from "next/navigation";

export default async function Home({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();

  const dictionary = getDictionary(lang);
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={dictionary.common.overview}
        title={dictionary.nav.dashboard}
        description={dictionary.sectionDescriptions.dashboard}
      />
      <EmptyState
        icon={LayoutDashboard}
        eyebrow={dictionary.common.emptyLabel}
        title={dictionary.emptyStates.dashboard.title}
        message={dictionary.emptyStates.dashboard.message}
      />
    </div>
  );
}
