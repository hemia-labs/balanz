import { EmptyState } from "@/components/empty-state";
import { getDictionary, isLocale } from "@/lib/i18n";
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
    <EmptyState
      title={dictionary.nav.dashboard}
      message={dictionary.emptyState.message}
    />
  );
}
