import { notFound } from "next/navigation";
import { EmptyState } from "@/components/empty-state";
import { getDictionary, isLocale, locales } from "@/lib/i18n";
import { labelFor, nav } from "@/lib/nav";

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
  if (!nav.some(({ href }) => href === `/${section}`)) notFound();

  const dictionary = getDictionary(lang);
  return (
    <EmptyState
      title={labelFor(`/${section}`, dictionary, lang)}
      message={dictionary.emptyState.message}
    />
  );
}
