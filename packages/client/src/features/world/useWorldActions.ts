import { useOnline } from "../../lib/online";
import { useWorldPaused } from "../../mud/store";
import { useBirth } from "../birth/useBirth";

const BORN = 2;

/**
 * Whether on-chain actions (being born, entering a building) can be taken now, and why not: the World is paused,
 * the browser is offline, or (for entering) the player has no born character yet. The Town Center can always be
 * entered by someone without a character: that is where they are born. Looking inside never needs any of this.
 */
export function useWorldActions() {
  const paused = useWorldPaused();
  const online = useOnline();
  const { character } = useBirth();
  const born = character?.status === BORN;
  const blocked = paused ? "paused" : !online ? "offline" : undefined;
  return {
    paused,
    online,
    /** Why nothing on-chain can be done right now, if so. */
    blocked,
    /** Why this building cannot be entered now, if so (an i18n key). */
    enterBlockedReason: (slug: string): string | undefined =>
      blocked ? `status.${blocked}Short` : !born && slug !== "town-center" ? "status.bornFirst" : undefined,
  };
}
