import { Construction } from "lucide-react";
import type { ReactNode } from "react";

/** The scaffolding header of everything still being built: an honest "not yet", with what it will be below. */
export function UnderConstruction({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3 rounded-md border-2 border-dashed border-warning/60 bg-[repeating-linear-gradient(-45deg,transparent_0_10px,rgb(0_0_0/0.04)_10px_20px)] p-4">
        <Construction aria-hidden className="size-8 shrink-0 text-warning" strokeWidth={1.5} />
        <p className="font-display text-lg">{title}</p>
      </div>
      {children}
    </div>
  );
}
