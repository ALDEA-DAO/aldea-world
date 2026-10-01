import { Link } from "react-router-dom";
import { TribeChip } from "../ui/TribeChip";

/** The player's soul in the HUD: the tribe (once born) and the short identifier, linking to the Soul Registry. */
export function SoulChip({ almaId, tribe }: { almaId: string; tribe?: number }) {
  return (
    <Link to="/b/registro-de-almas" title={almaId} className="inline-flex min-h-11 items-center gap-2 rounded-md px-2 hover:bg-black/20">
      {tribe !== undefined && <TribeChip tribe={tribe} size="sm" />}
      <span className="hidden font-mono text-xs opacity-80 sm:inline">{`${almaId.slice(16, 22)}…${almaId.slice(-4)}`}</span>
    </Link>
  );
}
