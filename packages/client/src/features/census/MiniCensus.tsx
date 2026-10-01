import { Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useCensus } from "../../mud/store";

/** The census at a glance for the HUD: souls born (and gestating, when any), linking to the Town Center. */
export function MiniCensus() {
  const { t } = useTranslation();
  const census = useCensus();
  if (!census) return null;
  return (
    <Link
      to="/b/centro-urbano"
      data-testid="mini-census"
      title={t("census.summary", { born: census.totalPopulation, gestating: census.gestating })}
      className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 text-sm whitespace-nowrap hover:bg-black/20"
    >
      <Users aria-hidden className="size-4" />
      <span className="font-bold tabular-nums">{census.totalPopulation}</span>
      {census.gestating > 0 && <span className="tabular-nums opacity-80">+{census.gestating}</span>}
      <span className="sr-only">{t("census.summary", { born: census.totalPopulation, gestating: census.gestating })}</span>
    </Link>
  );
}
