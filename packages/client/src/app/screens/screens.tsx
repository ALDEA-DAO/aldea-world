import { buildingByRoute } from "@aldea/shared/catalog";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Placeholder } from "./Placeholder";
import { isSignedIn } from "../../features/auth/AlmaAuthProvider";
import { useAlmaSession } from "../../features/auth/useAlmaSession";
import { YourKeys } from "../../features/soul/YourKeys";
import { useCensus } from "../../mud/store";

export function VillageScreen() {
  const { t } = useTranslation();
  return (
    <Placeholder title={t("screens.village")}>
      <p className="mt-2 text-lg">{t("app.tagline")}</p>
      <CensusLine />
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

export function SoulScreen() {
  const { t } = useTranslation();
  const { almaId } = useParams();
  const session = useAlmaSession();
  return (
    <Placeholder title={t("screens.soul")}>
      <p className="mt-2 font-mono text-xs break-all">{almaId}</p>
      {isSignedIn(session.status) && session.almaId === almaId && <YourKeys />}
    </Placeholder>
  );
}

export function SimpleScreen({ titleKey }: { titleKey: string }) {
  const { t } = useTranslation();
  return <Placeholder title={t(titleKey)} />;
}

export function NotFoundScreen() {
  const { t } = useTranslation();
  return <Placeholder title={t("screens.notFound")} />;
}
