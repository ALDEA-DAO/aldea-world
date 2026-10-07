import type { BuildingInfo } from "@aldea/shared/catalog";
import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import { Skeleton } from "../../components/ui/Skeleton";
import { SoulRegistryContent } from "./SoulRegistry";
import { TownCenter } from "./TownCenter";
import { UnderConstructionPanel } from "./UnderConstructionPanel";

// The Portal brings the Atlas client with it, and the Council its votes: loaded when someone opens them
const Portal = lazy(() => import("../atlas/Portal").then((m) => ({ default: m.Portal })));
const Council = lazy(() => import("./Council").then((m) => ({ default: m.Council })));

/** What is inside a building: the same content in the village's panel and in List mode. */
export function BuildingContent({ building, onExplore }: { building: BuildingInfo; onExplore: () => void }) {
  const { t } = useTranslation();
  if (building.kind === "TownCenter") return <TownCenter onExplore={onExplore} />;
  if (building.kind === "SoulRegistry") return <SoulRegistryContent />;
  if (building.kind === "Council") {
    return (
      <Suspense fallback={<Skeleton variant="block" className="h-40" />}>
        <Council />
      </Suspense>
    );
  }
  if (building.kind === "Portal") {
    return (
      <Suspense fallback={<Skeleton variant="block" className="h-40" />}>
        <Portal layout="panel" />
      </Suspense>
    );
  }
  if (building.underConstruction) return <UnderConstructionPanel building={building} />;
  return <p>{t("common.comingSoon")}</p>;
}
