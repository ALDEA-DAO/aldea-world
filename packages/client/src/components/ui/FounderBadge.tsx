import { Stamp } from "lucide-react";
import { useTranslation } from "react-i18next";

/** The Founder seal: this soul held $ALDEA when the world was founded, attested on-chain. */
export function FounderBadge() {
  const { t } = useTranslation();
  return (
    <span data-testid="founder-badge" className="inline-flex items-center gap-1 rounded-sm bg-accent px-1.5 text-xs font-bold text-on-accent">
      <Stamp aria-hidden className="size-3.5" />
      {t("founder.badge")}
    </span>
  );
}
