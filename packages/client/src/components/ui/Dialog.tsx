import clsx from "clsx";
import { X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  size?: "sm" | "md";
}

/**
 * Modal dialog on top of the native <dialog>: showModal() gives the focus trap, Esc to close and the inert
 * background; the previously focused element gets focus back on close.
 */
export function Dialog({ open, onClose, title, children, size = "sm" }: DialogProps) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => e.target === ref.current && onClose()}
      className={clsx(
        "m-auto w-[calc(100%-2rem)] rounded-lg border-2 border-wood bg-surface p-0 text-text shadow-raised",
        "backdrop:bg-[var(--color-backdrop)]",
        size === "sm" ? "max-w-[400px]" : "max-w-[480px]",
      )}
    >
      <div className="flex items-center justify-between gap-4 border-b border-border bg-surface-raised px-6 py-2">
        <h2 id={titleId} className="font-display text-2xl">
          {title}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("common.close")}
          className="inline-flex size-11 items-center justify-center rounded-md hover:bg-surface"
        >
          <X aria-hidden className="size-5" />
        </button>
      </div>
      <div className="p-6">{children}</div>
    </dialog>
  );
}
