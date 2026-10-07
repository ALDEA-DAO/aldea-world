import { useTranslation } from "react-i18next";
import { Prose, Sections } from "../../components/ui/Prose";

/** Changed by hand whenever the text in the locale files changes. */
const UPDATED = new Date("2026-10-07T12:00:00Z");
const CONTACT = "team@aldea.world";

/** `#/privacidad`: what is kept about a soul and what is public, as a reading page. A draft until counsel has reviewed it, and it says so. */
export function Privacy() {
  const { t, i18n } = useTranslation();
  return (
    <Prose
      title={t("screens.privacy")}
      also={[
        { to: "/acerca", key: "nav.about" },
        { to: "/terminos", key: "nav.terms" },
      ]}
    >
      <p className="text-sm text-text-muted">{t("legal.updated", { date: UPDATED.toLocaleDateString(i18n.language, { dateStyle: "long" }) })}</p>
      <p role="note" className="rounded-md border border-border bg-surface-raised p-3 text-sm">
        {t("legal.draft")}
      </p>
      <Sections of="privacy.sections" />
      <p>
        <a className="underline" href={`mailto:${CONTACT}`}>
          {t("legal.contact", { email: CONTACT })}
        </a>
      </p>
    </Prose>
  );
}
