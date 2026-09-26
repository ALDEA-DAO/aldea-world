import clsx from "clsx";

export interface SkeletonProps {
  variant?: "line" | "block" | "card";
  className?: string;
}

const shapes = {
  line: "h-4 w-full rounded-sm",
  block: "h-24 w-full rounded-md",
  card: "h-[200px] w-[160px] rounded-lg",
} as const;

/** Loading placeholder with a 1.2 s shimmer, disabled with prefers-reduced-motion (PRD § Design System > Skeleton). */
export function Skeleton({ variant = "line", className }: SkeletonProps) {
  return (
    <div
      aria-hidden
      className={clsx(
        "bg-surface-raised bg-[length:200%_100%] motion-safe:animate-[shimmer_1.2s_linear_infinite]",
        "bg-[linear-gradient(90deg,transparent_0%,rgb(255_255_255/0.25)_50%,transparent_100%)]",
        shapes[variant],
        className,
      )}
    />
  );
}
