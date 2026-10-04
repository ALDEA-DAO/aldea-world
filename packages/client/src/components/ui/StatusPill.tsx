import clsx from "clsx";
import type { ReactNode } from "react";

export type StatusTone = "success" | "warning" | "neutral" | "muted";

const tones: Record<StatusTone, string> = {
  success: "bg-success/15 text-text",
  warning: "bg-warning/15 text-text",
  neutral: "bg-surface-raised text-text",
  muted: "bg-surface-raised text-text-muted line-through",
};

/** A short status label; the text carries the meaning, the tone only reinforces it. */
export function StatusPill({ tone = "neutral", children }: { tone?: StatusTone; children: ReactNode }) {
  return <span className={clsx("inline-flex items-center rounded-sm px-1.5 text-xs font-bold whitespace-nowrap", tones[tone])}>{children}</span>;
}
