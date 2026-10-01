import { classes, tribes } from "@aldea/shared/catalog";
import { useTranslation } from "react-i18next";
import { Skeleton } from "../../components/ui/Skeleton";
import { useCensus } from "../../mud/store";
import { CensusBars } from "./CensusBars";

/**
 * The live census, straight from the World's `Census` table (synced by MUD): total, gestating, and the population
 * per tribe and per class. Changes are announced politely to screen readers through the summary line only, so a
 * birth is one announcement, not sixteen.
 */
export function CensusPanel() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "en" ? "en" : "es";
  const census = useCensus();
  if (!census) return <Skeleton className="h-48" />;

  return (
    <div className="flex flex-col gap-6" data-testid="census-panel">
      <p aria-live="polite" aria-atomic="true" className="text-lg">
        {t("census.summary", { born: census.totalPopulation, gestating: census.gestating })}
      </p>
      <CensusBars
        title={t("townCenter.byTribe")}
        bars={tribes.map((tribe, i) => ({ key: tribe.enum, label: tribe.name[lang], value: census.tribePopulation[i] ?? 0, color: `var(${tribe.colorToken})` }))}
      />
      <CensusBars
        title={t("townCenter.byClass")}
        bars={classes.map((c, i) => ({ key: c.enum, label: c.name[lang], value: census.classPopulation[i] ?? 0, color: "var(--color-secondary)" }))}
      />
    </div>
  );
}
