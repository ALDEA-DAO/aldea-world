import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Button } from "../../components/ui/Button";
import { isSignedIn } from "../../features/auth/AlmaAuthProvider";
import { useAlmaSession } from "../../features/auth/useAlmaSession";
import { LOCALES, setLocale, type Locale } from "../../lib/i18n";
import { getThemePreference, setThemePreference, type ThemePreference } from "../../lib/theme";

const themes: { value: ThemePreference; key: string }[] = [
  { value: "light", key: "settings.themeLight" },
  { value: "dark", key: "settings.themeDark" },
  { value: "system", key: "settings.themeSystem" },
];

export function SettingsScreen() {
  const { t, i18n } = useTranslation();
  const [theme, setTheme] = useState(getThemePreference);
  const { status, almaId } = useAlmaSession();

  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <h1 className="text-3xl">{t("screens.settings")}</h1>
      <fieldset className="mt-8">
        <legend className="mb-2 text-sm font-medium">{t("settings.theme")}</legend>
        <div className="flex flex-wrap gap-2">
          {themes.map((option) => (
            <Button
              key={option.value}
              variant={theme === option.value ? "secondary" : "ghost"}
              aria-pressed={theme === option.value}
              onClick={() => {
                setThemePreference(option.value);
                setTheme(option.value);
              }}
            >
              {t(option.key)}
            </Button>
          ))}
        </div>
      </fieldset>
      <fieldset className="mt-8">
        <legend className="mb-2 text-sm font-medium">{t("settings.language")}</legend>
        <div className="flex gap-2">
          {LOCALES.map((locale: Locale) => (
            <Button
              key={locale}
              variant={i18n.language === locale ? "secondary" : "ghost"}
              aria-pressed={i18n.language === locale}
              onClick={() => setLocale(locale)}
            >
              {locale === "es" ? "Español" : "English"}
            </Button>
          ))}
        </div>
      </fieldset>
      {isSignedIn(status) && almaId && (
        <p className="mt-8">
          <Link className="underline" to={`/alma/${almaId}`}>
            {t("settings.yourKeys")}
          </Link>
        </p>
      )}
    </div>
  );
}
