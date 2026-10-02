import { classByIndex, tribeByIndex } from "@aldea/shared/catalog";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Skeleton } from "../../components/ui/Skeleton";
import { Tabs } from "../../components/ui/Tabs";
import { useCensus, useMud, useWorldPaused } from "../../mud/store";
import { useAlmaSession } from "../auth/useAlmaSession";
import { BirthRitual } from "../birth/BirthRitual";
import { CensusPanel } from "../census/CensusPanel";
import { ClassPicker } from "../birth/ClassPicker";
import { useBirth } from "../birth/useBirth";

/**
 * The Town Center's interior: be born here, or see your character and the census. The birth ritual is drawn over the
 * dimmed village from the request to the reveal; `onExplore` runs when the newborn chooses to walk the village.
 */
export function TownCenter({ onExplore }: { onExplore?: () => void }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState("birth");
  const { stage, character, error, rescheduled, ready, birth, retryCompletion } = useBirth();
  const { almaId } = useAlmaSession();

  // The reveal is shown when this visit saw the birth happen, not on every later visit
  const [sawGestation, setSawGestation] = useState(false);
  const [ritualClosed, setRitualClosed] = useState(false);
  const inRitual = stage === "sending" || stage === "arriving" || stage === "choosing" || stage === "completing";
  if (inRitual && !sawGestation) setSawGestation(true);
  const showRitual = !ritualClosed && (inRitual || (stage === "born" && sawGestation));
  const completionFailed = Boolean(error && stage !== "idle" && stage !== "sending");

  return (
    <>
      <Tabs
          label={t("townCenter.title")}
          value={tab}
          onChange={setTab}
          items={[
            {
              id: "birth",
              label: stage === "born" ? t("townCenter.yourCharacter") : t("townCenter.beBorn"),
              content: <BirthTab stage={stage} ready={ready} character={character} error={inRitual ? undefined : error?.copyKey} onBirth={birth} />,
            },
            { id: "census", label: t("townCenter.census"), content: <CensusPanel /> },
          ]}
      />
      {showRitual && (
        <BirthRitual
          stage={stage}
          character={character}
          rescheduled={rescheduled}
          failed={completionFailed}
          onRetry={() => void retryCompletion()}
          onClose={() => {
            setRitualClosed(true);
            onExplore?.();
          }}
          almaId={almaId}
        />
      )}
    </>
  );
}

function BirthTab({
  stage,
  ready,
  character,
  error,
  onBirth,
}: {
  stage: ReturnType<typeof useBirth>["stage"];
  ready: boolean;
  character: ReturnType<typeof useBirth>["character"];
  error?: string;
  onBirth: (characterClass: number) => void;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "en" ? "en" : "es";
  const { network, error: networkError } = useMud();
  const paused = useWorldPaused();
  const census = useCensus();

  if (networkError) return <p role="alert">{t("townCenter.pathCut")}</p>;
  if (!network) return <Skeleton className="h-64" />;
  if (stage === "born" && character) {
    const tribe = tribeByIndex(character.tribe);
    return (
      <div className="flex flex-col gap-2 rounded-md border border-border p-4" style={{ borderColor: tribe ? `var(${tribe.colorToken})` : undefined }}>
        <p className="font-display text-2xl">
          {classByIndex(character.characterClass)?.name[lang]} · {tribe?.name[lang]}
        </p>
        <p className="text-sm text-text-muted">{t("townCenter.bornOn", { date: new Date(Number(character.bornAt) * 1000).toLocaleDateString(i18n.language) })}</p>
      </div>
    );
  }
  if (stage !== "idle" && stage !== "sending") return <p>{t("birth.arriving")}</p>;

  return (
    <div className="flex flex-col gap-4">
      {census?.totalPopulation === 0 && census.gestating === 0 && <p>{t("townCenter.beFirst")}</p>}
      {paused && <p role="alert">{t("townCenter.maintenance")}</p>}
      {error && <p role="alert">{t(error)}</p>}
      <ClassPicker onBirth={onBirth} busy={stage === "sending"} disabled={paused || !ready} />
    </div>
  );
}
