import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "../locales/en.json";
import es from "../locales/es.json";

export const LOCALES = ["es", "en"] as const;
export type Locale = (typeof LOCALES)[number];
const STORAGE_KEY = "aldea.locale";

function storedLocale(): Locale | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return LOCALES.includes(value as Locale) ? (value as Locale) : null;
  } catch {
    return null;
  }
}

/** Spanish is the default; English is used when the browser prefers it and the user has not chosen. */
function initialLocale(): Locale {
  const stored = storedLocale();
  if (stored) return stored;
  return navigator.language?.toLowerCase().startsWith("en") ? "en" : "es";
}

export function setLocale(locale: Locale) {
  void i18n.changeLanguage(locale);
  document.documentElement.lang = locale;
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // storage unavailable (private mode): the choice lasts for this session only
  }
}

void i18n.use(initReactI18next).init({
  resources: { es: { translation: es }, en: { translation: en } },
  lng: initialLocale(),
  fallbackLng: "es",
  interpolation: { escapeValue: false },
});
document.documentElement.lang = i18n.language;

export default i18n;
