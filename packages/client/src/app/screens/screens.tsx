import { buildingByRoute } from "@aldea/shared/catalog";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Placeholder } from "./Placeholder";

export function VillageScreen() {
  const { t } = useTranslation();
  return (
    <Placeholder title={t("screens.village")}>
      <p className="mt-2 text-lg">{t("app.tagline")}</p>
    </Placeholder>
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
  return (
    <Placeholder title={t("screens.soul")}>
      <p className="mt-2 font-mono text-xs break-all">{almaId}</p>
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
