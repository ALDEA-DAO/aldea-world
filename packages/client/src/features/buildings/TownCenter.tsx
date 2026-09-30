import { classByIndex, classes, tribeByIndex, tribes } from "@aldea/shared/catalog";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Panel } from "../../components/ui/Panel";
import { Skeleton } from "../../components/ui/Skeleton";
import { Tabs } from "../../components/ui/Tabs";
import { useCensus, useMud, useWorldPaused } from "../../mud/store";
import { useAlmaSession } from "../auth/useAlmaSession";
import { BirthRitual } from "../birth/BirthRitual";
import { ClassPicker } from "../birth/ClassPicker";
import { useBirth } from "../birth/useBirth";

/**
 * The Town Center (no map yet): be born here, or see your character and the census. The birth ritual covers the
 * screen from the request to the reveal.
 */
export function TownCenter() {
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
    <div className="mx-auto max-w-2xl px-4 py-8">
      <Panel variant="inline" title={t("townCenter.title")}>
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
            { id: "census", label: t("townCenter.census"), content: <CensusTab /> },
          ]}
        />
      </Panel>
      {showRitual && (
        <BirthRitual
          stage={stage}
          character={character}
          rescheduled={rescheduled}
          failed={completionFailed}
          onRetry={() => void retryCompletion()}
          onClose={() => setRitualClosed(true)}
          almaId={almaId}
        />
      )}
    </div>
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

function CensusTab() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "en" ? "en" : "es";
  const census = useCensus();
  if (!census) return <Skeleton className="h-48" />;
  const maxTribe = Math.max(1, ...census.tribePopulation);
  const maxClass = Math.max(1, ...census.classPopulation);

  return (
    <div className="flex flex-col gap-6" aria-live="polite">
      <p className="text-lg">{t("census.summary", { born: census.totalPopulation, gestating: census.gestating })}</p>
      <section>
        <h3 className="mb-2 font-display">{t("townCenter.byTribe")}</h3>
        {tribes.map((tribe, i) => (
          <Bar key={tribe.enum} label={tribe.name[lang]} value={census.tribePopulation[i] ?? 0} max={maxTribe} color={`var(${tribe.colorToken})`} />
        ))}
      </section>
      <section>
        <h3 className="mb-2 font-display">{t("townCenter.byClass")}</h3>
        {classes.map((c, i) => (
          <Bar key={c.enum} label={c.name[lang]} value={census.classPopulation[i] ?? 0} max={maxClass} color="var(--color-wood)" />
        ))}
      </section>
    </div>
  );
}

function Bar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  return (
    <div className="mb-1 grid grid-cols-[8rem_1fr_2rem] items-center gap-2 text-sm">
      <span>{label}</span>
      <span className="h-3 rounded-full bg-surface">
        <span className="block h-3 rounded-full" style={{ width: `${(value / max) * 100}%`, background: color }} />
      </span>
      <span className="text-right tabular-nums">{value}</span>
    </div>
  );
}
