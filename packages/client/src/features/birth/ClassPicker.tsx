import { classes } from "@aldea/shared/catalog";
import { useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/ui/Button";
import { ClassCard } from "../../components/ui/ClassCard";
import { RequireSession } from "../auth/RequireSession";
import { CLASS_ICONS } from "./icons";

/**
 * The 11 classes as a radio group (arrows, Home and End move and select) and "Be born as {Class}". The button is
 * disabled from the first click: one birth, one confirmation.
 */
export function ClassPicker({ onBirth, busy, disabled }: { onBirth: (characterClass: number) => void; busy: boolean; disabled?: boolean }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "en" ? "en" : "es";
  const [selected, setSelected] = useState<number>();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const move = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const columns = window.matchMedia("(min-width: 640px)").matches ? 3 : 2;
    const next = { ArrowRight: index + 1, ArrowDown: index + columns, ArrowLeft: index - 1, ArrowUp: index - columns, Home: 0, End: classes.length - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    const i = Math.min(classes.length - 1, Math.max(0, next));
    setSelected(i);
    refs.current[i]?.focus();
  };

  const chosen = selected === undefined ? undefined : classes[selected];
  return (
    <div>
      <div role="radiogroup" aria-label={t("townCenter.chooseClass")} className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {classes.map((c, i) => (
          <ClassCard
            key={c.enum}
            ref={(el) => {
              refs.current[i] = el;
            }}
            name={c.name[lang]}
            line={c.affinity[lang]}
            Icon={CLASS_ICONS[i]!}
            checked={selected === i}
            tabIndex={(selected ?? 0) === i ? 0 : -1}
            onSelect={() => setSelected(i)}
            onKeyDown={(e) => move(e, i)}
          />
        ))}
      </div>
      <div className="sticky bottom-0 mt-4 bg-surface-raised py-2">
        <RequireSession action={t("townCenter.beBornAction")}>
          <Button size="lg" className="w-full" disabled={!chosen || busy || disabled} onClick={() => chosen && onBirth(chosen.index)}>
            {chosen ? t("townCenter.beBornAs", { name: chosen.name[lang] }) : t("townCenter.pickAClass")}
          </Button>
        </RequireSession>
      </div>
    </div>
  );
}
