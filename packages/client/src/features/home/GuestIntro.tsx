import { X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useAlmaSession } from "../auth/useAlmaSession";
import { useFounder } from "../founders/useFounder";

const SEEN_KEY = "aldea:welcomed";
const seen = () => {
  try {
    return sessionStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return false;
  }
};

/**
 * The welcome a guest finds over the village: what this is, in one line, and the two things they can do (be born, or
 * just look). During Genesis it also says until when Founders are born first: a date, stated once, with no countdown.
 * It never covers the village for long: it closes for the rest of the visit.
 */
export function GuestIntro() {
  const { t, i18n } = useTranslation();
  const { status } = useAlmaSession();
  const { genesisActive, genesisEndsAt } = useFounder();
  const [closed, setClosed] = useState(seen);
  if (status !== "guest" || closed) return null;

  const close = () => {
    setClosed(true);
    try {
      sessionStorage.setItem(SEEN_KEY, "1");
    } catch {
      // storage unavailable: it comes back on the next load, which is fine
    }
  };

  return (
    <section aria-labelledby="welcome" data-testid="guest-intro" className="absolute top-4 left-4 z-10 max-w-[min(26rem,calc(100%-2rem))] rounded-lg border-2 border-wood bg-surface p-4 pr-12 text-text shadow-raised">
      <h1 id="welcome" className="font-display text-2xl leading-tight">
        {t("home.headline")}
      </h1>
      <p className="mt-2 text-sm">{t("home.lead")}</p>
      {genesisActive && genesisEndsAt && (
        <p className="mt-2 text-sm" data-testid="genesis-dates">
          {t("home.genesis", { date: genesisEndsAt.toLocaleDateString(i18n.language, { dateStyle: "long" }) })}
        </p>
      )}
      <p className="mt-3 flex flex-wrap items-center gap-3 text-sm">
        <Link to="/b/centro-urbano" onClick={close} className="inline-flex h-10 items-center rounded-md bg-primary px-4 font-medium text-on-primary bevel">
          {t("home.beBorn")}
        </Link>
        <button type="button" onClick={close} className="min-h-11 underline underline-offset-4">
          {t("home.look")}
        </button>
      </p>
      <button type="button" onClick={close} aria-label={t("home.dismiss")} className="absolute top-1 right-1 inline-flex size-11 items-center justify-center rounded-md hover:bg-surface-raised">
        <X aria-hidden className="size-5" />
      </button>
    </section>
  );
}
