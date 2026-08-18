import es from "@/dictionaries/es.json";

export const locales = ["es"] as const;
export const defaultLocale = "es";
export type Locale = (typeof locales)[number];
export type Dictionary = typeof es;

const dictionaries: Record<Locale, Dictionary> = { es };

export function isLocale(value: string): value is Locale {
  return locales.includes(value as Locale);
}

export function getDictionary(locale: Locale): Dictionary {
  return dictionaries[locale];
}
