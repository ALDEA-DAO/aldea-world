import { useTranslation } from "react-i18next";
import { Button } from "../../components/ui/Button";
import { TribeReveal } from "./TribeReveal";
import type { BirthCharacter, BirthStage } from "./useBirth";

/**
 * The wait turned into a moment: a circle of embers for as long as the birth gestates, narrative copy per stage and
 * the tribe's reveal. Never a spinner; with reduced motion the embers hold still.
 */
export function BirthRitual({
  stage,
  character,
  rescheduled,
  failed,
  onRetry,
  onClose,
  almaId,
}: {
  stage: BirthStage;
  character?: BirthCharacter;
  rescheduled: boolean;
  failed: boolean;
  onRetry: () => void;
  onClose: () => void;
  almaId?: string;
}) {
  const { t } = useTranslation();
  const copy = failed
    ? t("birth.failed")
    : rescheduled && stage !== "born"
      ? t("birth.rekindled")
      : { sending: t("birth.arriving"), arriving: t("birth.arriving"), choosing: t("birth.choosing"), completing: t("birth.completing") }[stage as string];

  return (
    <div role="dialog" aria-modal="true" aria-label={t("birth.title")} className="fixed inset-0 z-40 grid place-items-center bg-backdrop p-4">
      <div className="flex w-full max-w-md flex-col items-center gap-6 rounded-lg bg-surface-raised p-8 text-center shadow-paper">
        {stage === "born" && character ? (
          <TribeReveal tribe={character.tribe} characterClass={character.characterClass} almaId={almaId} onClose={onClose} />
        ) : (
          <>
            <div className="embers" aria-hidden>
              {Array.from({ length: 8 }, (_, i) => (
                <span key={i} style={{ ["--i" as string]: i }} />
              ))}
            </div>
            <p aria-live="polite" className="font-display text-2xl">
              {copy}
            </p>
            {failed && <Button onClick={onRetry}>{t("birth.retry")}</Button>}
            <details className="text-sm text-text-muted">
              <summary className="cursor-pointer underline">{t("birth.howDrawn")}</summary>
              <p className="mt-2">{t("birth.howDrawnText")}</p>
            </details>
          </>
        )}
      </div>
    </div>
  );
}
