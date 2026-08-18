import { notFound } from "next/navigation";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { getDictionary, isLocale, locales } from "@/lib/i18n";
import { nav } from "@/lib/nav";

export function generateStaticParams() {
  return locales.flatMap((lang) =>
    nav.filter(({ href }) => href !== "/").map(({ href }) => ({
      lang,
      section: href.slice(1),
    }))
  );
}

export default async function Section({
  params,
}: {
  params: Promise<{ lang: string; section: string }>;
}) {
  const { lang, section } = await params;
  if (!isLocale(lang)) notFound();
  const item = nav.find(({ href }) => href === "/" + section);
  if (!item) notFound();

  const dictionary = getDictionary(lang);
  return (
    <div className="space-y-6">
      <PageHeader
        title={dictionary.nav[item.labelKey]}
        description={dictionary.sectionDescriptions[item.labelKey]}
      />
      <EmptyState
        icon={item.icon}
        eyebrow={dictionary.common.emptyLabel}
        title={dictionary.emptyStates[item.labelKey].title}
        message={dictionary.emptyStates[item.labelKey].message}
      />
    </div>
  );
}
