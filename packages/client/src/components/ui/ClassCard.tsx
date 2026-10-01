import clsx from "clsx";
import type { LucideIcon } from "lucide-react";
import type { KeyboardEvent, Ref } from "react";

export interface ClassCardProps {
  name: string;
  line: string;
  Icon: LucideIcon;
  checked: boolean;
  /** Only the checked card (or the first) is in the tab order: arrows move within the group. */
  tabIndex: 0 | -1;
  onSelect: () => void;
  onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => void;
  ref?: Ref<HTMLButtonElement>;
}

/** One class in the picker: a radio with its art, name and one line. Chosen cards get a wood frame and an ember glow. */
export function ClassCard({ name, line, Icon, checked, tabIndex, onSelect, onKeyDown, ref }: ClassCardProps) {
  return (
    <button
      ref={ref}
      type="button"
      role="radio"
      aria-checked={checked}
      tabIndex={tabIndex}
      onClick={onSelect}
      onKeyDown={onKeyDown}
      className={clsx(
        "flex min-h-11 flex-col items-center gap-1 rounded-md border-2 bg-surface p-3 text-center",
        "transition-[border-color,box-shadow] duration-fast ease-out-soft",
        checked ? "border-wood shadow-[0_0_0_3px_var(--color-accent)]" : "border-border hover:border-border-strong",
      )}
    >
      <Icon aria-hidden className="size-12 text-text" strokeWidth={1.5} />
      <span className="font-display text-lg leading-tight">{name}</span>
      <span className="text-xs text-text-muted">{line}</span>
    </button>
  );
}
