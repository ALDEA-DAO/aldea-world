import clsx from "clsx";
import { X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

export interface PanelProps {
  title: ReactNode;
  children: ReactNode;
  /** When provided, a close button is shown and Esc closes the panel. */
  onClose?: () => void;
  /** "side" on desktop (400 px) that turns into a bottom sheet (70 vh) on mobile; "inline" for static content. */
  variant?: "side" | "inline";
  className?: string;
}

/** Parchment panel for building interiors */
export function Panel({ title, children, onClose, variant = "side", className }: PanelProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <section
      ref={ref}
      role="region"
      aria-labelledby={titleId}
      className={clsx(
        "flex flex-col overflow-hidden rounded-lg border-2 border-wood bg-surface text-text shadow-raised",
        variant === "side" && [
          "fixed inset-x-0 bottom-0 max-h-[70vh] rounded-b-none animate-[sheet-in_var(--duration-base)_var(--ease-out)]",
          "md:inset-x-auto md:top-[calc(var(--hud-top)+var(--space-4))] md:right-4 md:bottom-[calc(var(--hud-bottom)+var(--space-4))]",
          "md:max-h-none md:w-panel md:rounded-lg md:animate-[panel-in_var(--duration-base)_var(--ease-out)]",
        ],
        className,
      )}
    >
      <header className="flex items-center justify-between gap-4 border-b border-border bg-surface-raised px-4 py-2 md:px-6">
        <h2 id={titleId} className="font-display text-2xl">
          {title}
        </h2>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="inline-flex size-11 items-center justify-center rounded-md hover:bg-surface"
          >
            <X aria-hidden className="size-5" />
          </button>
        )}
      </header>
      <div className="overflow-y-auto p-4 md:p-6">{children}</div>
    </section>
  );
}
