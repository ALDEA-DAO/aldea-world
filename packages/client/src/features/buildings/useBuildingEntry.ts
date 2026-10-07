import type { BuildingInfo } from "@aldea/shared/catalog";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useToast } from "../../components/ui/Toast";
import { decodeGameError } from "../../lib/errors";
import { useMud } from "../../mud/store";
import { useBirth } from "../birth/useBirth";
import { useWorldActions } from "../world/useWorldActions";
import { track } from "../../lib/analytics";

const BORN = 2;
// Entries and exits are sent one after another, in the order the player made them
let queue: Promise<unknown> = Promise.resolve();

/**
 * Records on-chain that the player's character is in `building` for as long as its panel is open: `enterBuilding`
 * when the panel opens (one retry, then a discreet notice; the panel never waits for it) and `leaveBuilding` when it
 * closes, without blocking. Guests and souls without a born character just look: nothing is sent.
 */
export function useBuildingEntry(building: BuildingInfo | undefined) {
  const { t } = useTranslation();
  const toast = useToast();
  const { systemCalls } = useMud();
  const { character } = useBirth();
  const born = character?.status === BORN;
  const { blocked } = useWorldActions();
  // While paused or offline the panel still opens (looking is always allowed) but nothing is sent
  const id = blocked ? undefined : building?.id;
  const slug = building?.slug;

  const notify = useRef<(err: unknown) => void>(() => {});
  useEffect(() => {
    notify.current = (err) => {
      const { name, copyKey } = decodeGameError(err);
      toast.show(t(name === "unknown" || name === "network" ? "errors.entryNotRecorded" : copyKey), "warning");
    };
  }, [t, toast]);

  useEffect(() => {
    if (!systemCalls || !born || !id) return;
    let sent = false;
    // Deferred one tick: a panel that mounts and unmounts at once (React's development double mount) sends nothing
    const timer = setTimeout(() => {
      sent = true;
      queue = queue.then(async () => {
        try {
          await systemCalls.enterBuilding(id);
          track("building_entered", { buildingId: slug ?? "" });
        } catch (first) {
          // A revert would revert again: only what may be a passing network failure is retried
          const { name } = decodeGameError(first);
          if (name !== "unknown" && name !== "network") return notify.current(first);
          await systemCalls.enterBuilding(id).catch((second: unknown) => notify.current(second));
        }
      });
    }, 0);
    return () => {
      clearTimeout(timer);
      if (sent) queue = queue.then(() => systemCalls.leaveBuilding().catch(() => undefined));
    };
  }, [systemCalls, born, id, slug]);
}
