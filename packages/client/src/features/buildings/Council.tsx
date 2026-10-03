import { COUNCIL_OPENS_AT } from "@aldea/shared/catalog";
import { useTranslation } from "react-i18next";

/**
 * The Council before the Genesis Charter opens: when it will, and what will be decided there. The Charter itself
 * (what is ratified, the rule, your voice, the tally) arrives with the Council's phase.
 */
export function Council() {
  const { t, i18n } = useTranslation();
  const opensAt = COUNCIL_OPENS_AT ? new Date(COUNCIL_OPENS_AT) : undefined;
  return (
    <div className="flex flex-col gap-4" data-testid="council">
      <h3 className="font-display text-xl">{t("council.charter")}</h3>
      <p role="status">
        {opensAt && !Number.isNaN(opensAt.getTime())
          ? t("council.opensOn", { date: opensAt.toLocaleDateString(i18n.language, { dateStyle: "long" }) })
          : t("council.opensSoon")}
      </p>
      <p className="text-sm text-text-muted">{t("council.whatItIs")}</p>
    </div>
  );
}
