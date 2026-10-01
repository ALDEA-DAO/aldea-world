import { buildingByRoute } from "@aldea/shared/catalog";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Placeholder } from "./Placeholder";
import { SoulRegistry } from "../../features/buildings/SoulRegistry";
import { useCensus } from "../../mud/store";
import { TownCenter } from "../../features/buildings/TownCenter";

export function VillageScreen() {
  const { t } = useTranslation();
  return (
    <Placeholder title={t("screens.village")}>
      <p className="mt-2 text-lg">{t("app.tagline")}</p>
      <CensusLine />
      <Link to="/b/centro-urbano" className="mt-6 inline-flex h-12 items-center rounded-md bg-primary px-5 font-medium text-on-primary bevel">
        {t("village.beBorn")}
      </Link>
    </Placeholder>
  );
}

/** Live census from the World (until the Town Center panel and the HUD show it). */
function CensusLine() {
  const { t } = useTranslation();
  const census = useCensus();
  if (!census) return null;
  return (
    <p className="mt-4" data-testid="census">
      {t("census.summary", { born: census.totalPopulation, gestating: census.gestating })}
    </p>
  );
}

export function BuildingScreen() {
  const { t, i18n } = useTranslation();
  const { buildingSlug = "" } = useParams();
  const building = buildingByRoute(buildingSlug);
  if (!building) return <NotFoundScreen />;
  if (building.kind === "TownCenter") return <TownCenter />;
  if (building.kind === "SoulRegistry") return <SoulRegistry />;
  return <Placeholder title={building.name[i18n.language === "en" ? "en" : "es"]}>{t("screens.building")}</Placeholder>;
}

export function WorldScreen() {
  const { t } = useTranslation();
  const { worldId } = useParams();
  return (
    <Placeholder title={t("screens.world")}>
      <p className="mt-2 font-mono text-xs break-all">{worldId}</p>
    </Placeholder>
  );
}

/** The public view of any soul (your own shows your keys too). */
export function SoulScreen() {
  const { almaId } = useParams();
  return <SoulRegistry almaId={almaId} />;
}

export function SimpleScreen({ titleKey }: { titleKey: string }) {
  const { t } = useTranslation();
  return <Placeholder title={t(titleKey)} />;
}

export function NotFoundScreen() {
  const { t } = useTranslation();
  return <Placeholder title={t("screens.notFound")} />;
}
