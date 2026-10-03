import { buildingById, buildings as catalog } from "@aldea/shared/catalog";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import type { Hex } from "viem";
import { useBirth } from "../features/birth/useBirth";
import { useMud, useWorld, type WorldState } from "../mud/store";
import { hasWebGL } from "./webglCheck";
import { GameBridge, type GameState, type WorldBuilding, type WorldCharacter } from "./bridge";

const BORN = 2;
const NOWHERE = /^0x0+$/;
const selectRecords = (state: WorldState) => state.records;
const fallbackBuildings: WorldBuilding[] = catalog.map((b) => ({ slug: b.slug, door: b.door, underConstruction: b.underConstruction }));

/** What the World says is in the village: buildings, the born characters and where each was last seen. */
function useVillageWorld(ownId: number | undefined) {
  const { network } = useMud();
  const records = useWorld(selectRecords);
  return useMemo(() => {
    const buildings: WorldBuilding[] = [];
    const others: WorldCharacter[] = [];
    if (!network || !records) return { buildings: fallbackBuildings, others };
    const { Building, Character, Location } = network.tables;
    const seenAt = new Map<number, string>();
    for (const record of Object.values(records)) {
      if (record.table.tableId !== Location.tableId) continue;
      const { characterId } = record.key as { characterId: number };
      const { buildingId } = record.value as { buildingId: Hex };
      const slug = NOWHERE.test(buildingId) ? undefined : buildingById(buildingId)?.slug;
      if (slug) seenAt.set(characterId, slug);
    }
    for (const record of Object.values(records)) {
      if (record.table.tableId === Building.tableId) {
        const slug = buildingById((record.key as { id: Hex }).id)?.slug;
        const value = record.value as { x: number; y: number; underConstruction: boolean };
        if (slug) buildings.push({ slug, door: { x: value.x, y: value.y }, underConstruction: value.underConstruction });
      } else if (record.table.tableId === Character.tableId) {
        const { id } = record.key as { id: number };
        const value = record.value as { characterClass: number; tribe: number; status: number };
        if (value.status === BORN && id !== ownId) others.push({ id, characterClass: value.characterClass, tribe: value.tribe, at: seenAt.get(id) });
      }
    }
    buildings.sort((a, b) => a.door.y - b.door.y || a.door.x - b.door.x);
    // The newest souls first: the scene draws a limited crowd
    others.sort((a, b) => b.id - a.id);
    return { buildings: buildings.length ? buildings : fallbackBuildings, others };
  }, [network, records, ownId]);
}

/**
 * The village canvas. Phaser loads after the first render; the World's buildings and characters flow in through the
 * bridge, and `children` renders over the canvas with the scene's state (ready, the door the player stands at).
 */
export function PhaserCanvas({ onEnterDoor, children }: { onEnterDoor: (slug: string) => void; children: (state: GameState) => React.ReactNode }) {
  const { t } = useTranslation();
  const holder = useRef<HTMLDivElement>(null);
  const [bridge] = useState(() => new GameBridge());
  const state = useSyncExternalStore(
    (notify) => bridge.onState(notify),
    () => bridge.state,
  );
  const { character } = useBirth();
  const born = character?.status === BORN ? character : undefined;
  const world = useVillageWorld(born?.id);
  const playerClass = born?.characterClass;
  const playerTribe = born?.tribe;
  const label = t("village.canvasLabel");

  useEffect(() => {
    bridge.setEnterHandler(onEnterDoor);
  }, [bridge, onEnterDoor]);

  useEffect(() => {
    bridge.setWorld({
      buildings: world.buildings,
      others: world.others,
      player: playerClass === undefined || playerTribe === undefined ? undefined : { characterClass: playerClass, tribe: playerTribe },
    });
  }, [bridge, world, playerClass, playerTribe]);

  useEffect(() => {
    const parent = holder.current;
    if (!parent) return;
    if (!hasWebGL()) {
      bridge.setState({ failed: "webgl" });
      return;
    }
    let stop: (() => void) | undefined;
    let current = true;
    void import("./game")
      .then(({ startGame }) => {
        if (current) stop = startGame(parent, bridge, label);
      })
      .catch((err: unknown) => bridge.setState({ failed: err instanceof Error ? err.message : String(err) }));
    return () => {
      current = false;
      stop?.();
      bridge.setState({ ready: false, door: undefined });
    };
  }, [bridge, label]);

  return (
    <div
      className="absolute inset-0 overflow-hidden bg-[#1d2b22]"
      data-testid="village"
      data-ready={state.ready}
      data-lite={Boolean(state.lite)}
      data-door={state.door ?? ""}
      data-tile={state.playerTile ? `${state.playerTile.x},${state.playerTile.y}` : ""}
    >
      <div ref={holder} className="absolute inset-x-0 top-0 bottom-hud-bottom [&>canvas]:block [&>canvas]:touch-none" />
      {children(state)}
    </div>
  );
}
