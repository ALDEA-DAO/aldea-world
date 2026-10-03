import type { BuildingInfo } from "@aldea/shared/catalog";
import { useTranslation } from "react-i18next";
import { UnderConstruction } from "../../components/ui/UnderConstruction";
import type { WaitlistBuilding } from "./useWaitlist";
import { WaitlistButton } from "./WaitlistButton";

const WAITLIST: Partial<Record<BuildingInfo["kind"], WaitlistBuilding>> = { VelumArchive: "velum_archive", NpcForge: "npc_forge" };

/**
 * A building under construction (Velum Archive, NPC Forge): what it will do, which AdaSouls rail it demonstrates and
 * an honest estimated date, all from the catalog, and "Anotarme".
 */
export function UnderConstructionPanel({ building }: { building: BuildingInfo }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "en" ? "en" : "es";
  const info = building.construction;
  const waitlist = WAITLIST[building.kind];
  return (
    <UnderConstruction title={t("construction.title")}>
      {info && (
        <dl className="flex flex-col gap-4">
          <div>
            <dt className="text-sm font-bold">{t("construction.willDo")}</dt>
            <dd>{info.willDo[lang]}</dd>
          </div>
          <div>
            <dt className="text-sm font-bold">{t("construction.rail")}</dt>
            <dd>{info.rail[lang]}</dd>
          </div>
          <div>
            <dt className="text-sm font-bold">{t("construction.estimated")}</dt>
            <dd>{info.estimated[lang]}</dd>
          </div>
        </dl>
      )}
      {waitlist && (
        <div className="mt-2">
          <WaitlistButton building={waitlist} />
        </div>
      )}
    </UnderConstruction>
  );
}
