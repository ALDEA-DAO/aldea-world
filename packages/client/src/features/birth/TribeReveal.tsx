import { classByIndex, tribeByIndex } from "@aldea/shared/catalog";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Button } from "../../components/ui/Button";
import { TRIBE_ICONS } from "./icons";

/** The reveal: a burst of the tribe's color, its name and biome, announced to screen readers. */
export function TribeReveal({ tribe, characterClass, almaId, onClose }: { tribe: number; characterClass: number; almaId?: string; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "en" ? "en" : "es";
  const info = tribeByIndex(tribe);
  const cls = classByIndex(characterClass);
  if (!info || !cls) return null;
  const Icon = TRIBE_ICONS[tribe]!;

  return (
    <div className="tribe-reveal flex flex-col items-center gap-3" style={{ ["--tribe" as string]: `var(${info.colorToken})` }}>
      <div className="grid size-28 place-items-center rounded-full bg-[var(--tribe)] text-[var(--on-tribe)]">
        <Icon aria-hidden className="size-14" strokeWidth={1.5} />
      </div>
      <p aria-live="polite" className="font-display text-4xl text-[var(--tribe)]">
        <span className="sr-only">{t("birth.bornInto")} </span>
        {info.name[lang]}
      </p>
      <p className="text-text-muted">
        {cls.name[lang]} · {info.biome[lang]}
      </p>
      <p className="text-lg">{t("birth.named")}</p>
      {almaId && <p className="font-mono text-xs break-all text-text-muted">{almaId}</p>}
      <div className="mt-2 flex flex-wrap justify-center gap-2">
        {almaId && (
          <Link to={`/alma/${almaId}`} className="inline-flex h-10 items-center rounded-md px-4 underline" onClick={onClose}>
            {t("birth.viewSoul")}
          </Link>
        )}
        <Button onClick={onClose}>{t("birth.explore")}</Button>
      </div>
    </div>
  );
}
