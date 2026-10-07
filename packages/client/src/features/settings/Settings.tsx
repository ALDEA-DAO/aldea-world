import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Button } from "../../components/ui/Button";
import { LOCALES, setLocale, type Locale } from "../../lib/i18n";
import { getMotionPreference, setMotionPreference, type MotionPreference } from "../../lib/motion";
import { getThemePreference, setThemePreference, type ThemePreference } from "../../lib/theme";
import { isSignedIn } from "../auth/AlmaAuthProvider";
import { useAlmaSession } from "../auth/useAlmaSession";
import { AboutVersion } from "./AboutVersion";

const themes: { value: ThemePreference; key: string }[] = [
  { value: "light", key: "settings.themeLight" },
  { value: "dark", key: "settings.themeDark" },
  { value: "system", key: "settings.themeSystem" },
];
const motions: { value: MotionPreference; key: string }[] = [
  { value: "system", key: "settings.motionSystem" },
  { value: "reduced", key: "settings.motionReduced" },
];
const LANGUAGE_NAMES: Record<Locale, string> = { es: "Español", en: "English" };

/** One choice among a few, as a group of toggle buttons named by its legend. */
function Choice<T extends string>({ legend, options, value, onChange, hint }: { legend: string; options: { value: T; label: string }[]; value: T; onChange: (value: T) => void; hint?: ReactNode }) {
  return (
    <fieldset className="mt-8">
      <legend className="mb-2 text-sm font-medium">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <Button key={option.value} variant={value === option.value ? "secondary" : "ghost"} aria-pressed={value === option.value} onClick={() => onChange(option.value)}>
            {option.label}
          </Button>
        ))}
      </div>
      {hint && <p className="mt-2 text-sm text-text-muted">{hint}</p>}
    </fieldset>
  );
}

/**
 * `#/ajustes`: language, theme and motion for everyone; for a signed-in soul, also the way to its keys and signing
 * out. Every choice applies at once, without reloading, and is remembered in this browser. There is no sound switch
 * because the village makes no sound yet.
 */
export function SettingsScreen() {
  const { t, i18n } = useTranslation();
  const [theme, setTheme] = useState(getThemePreference);
  const [motion, setMotion] = useState(getMotionPreference);
  const [signOutFailed, setSignOutFailed] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const { status, signOut } = useAlmaSession();

  const leave = async () => {
    setSigningOut(true);
    setSignOutFailed(false);
    try {
      await signOut();
    } catch {
      setSignOutFailed(true);
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-12">
      <h1 className="text-3xl">{t("screens.settings")}</h1>
      <Choice legend={t("settings.language")} options={LOCALES.map((locale) => ({ value: locale, label: LANGUAGE_NAMES[locale] }))} value={(i18n.language === "en" ? "en" : "es") as Locale} onChange={setLocale} />
      <Choice
        legend={t("settings.theme")}
        options={themes.map((option) => ({ value: option.value, label: t(option.key) }))}
        value={theme}
        onChange={(value) => {
          setThemePreference(value);
          setTheme(value);
        }}
      />
      <Choice
        legend={t("settings.motion")}
        options={motions.map((option) => ({ value: option.value, label: t(option.key) }))}
        value={motion}
        onChange={(value) => {
          setMotionPreference(value);
          setMotion(value);
        }}
        hint={t("settings.motionHint")}
      />
      <AboutVersion />
      {isSignedIn(status) && (
        <>
          <section aria-labelledby="settings-keys" className="mt-8">
            <h2 id="settings-keys" className="text-sm font-medium">
              {t("settings.yourKeys")}
            </h2>
            <p className="mt-2 text-sm">
              <Link className="underline" to="/b/registro-de-almas">
                {t("settings.keysHint")}
              </Link>
            </p>
          </section>
          <section aria-labelledby="settings-session" className="mt-8 flex flex-col items-start gap-2">
            <h2 id="settings-session" className="text-sm font-medium">
              {t("settings.session")}
            </h2>
            {signOutFailed && <p role="alert">{t("settings.signOutFailed")}</p>}
            <Button variant="secondary" disabled={signingOut} onClick={() => void leave()}>
              {signOutFailed ? t("settings.retry") : t("settings.signOut")}
            </Button>
          </section>
        </>
      )}
      <nav aria-label={t("settings.legal")} className="mt-10 flex flex-wrap gap-x-4 gap-y-2 border-t border-border pt-4 text-sm">
        {(["about", "terms", "privacy"] as const).map((page) => (
          <Link key={page} className="underline underline-offset-4" to={{ about: "/acerca", terms: "/terminos", privacy: "/privacidad" }[page]}>
            {t(`nav.${page}`)}
          </Link>
        ))}
      </nav>
    </div>
  );
}
