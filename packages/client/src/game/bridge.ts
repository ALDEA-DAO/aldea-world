import type { Tile } from "./IsoMap";

/**
 * The link between React (which knows the World: buildings, the player's character, the other souls) and the Phaser
 * scene (which draws them and knows where the player walks). React sets the world; the scene reports what happens.
 */
export interface WorldBuilding {
  slug: string;
  /** Door tile, from the on-chain Building table. */
  door: Tile;
  underConstruction: boolean;
}

export interface WorldCharacter {
  id: number;
  characterClass: number;
  tribe: number;
  /** The soul has the Founder seal. */
  founder?: boolean;
  /** The building the character was last seen in, if any. */
  at?: string;
}

export interface GameState {
  ready: boolean;
  /** Why the game could not start (no WebGL, a failed load). */
  failed?: string;
  /** The building whose door the player is standing at. */
  door?: string;
  playerTile?: Tile;
  fps: number;
  /** The device could not keep 20 fps: particles and ambient animations are off. */
  lite?: boolean;
}

type Listener = () => void;

export class GameBridge {
  buildings: WorldBuilding[] = [];
  player?: { characterClass: number; tribe: number; founder?: boolean };
  others: WorldCharacter[] = [];
  state: GameState = { ready: false, fps: 0 };
  /** Set by React: the player asked (with the keyboard) to go into the building at this door. */
  onEnterDoor?: (slug: string) => void;
  setEnterHandler(handler: (slug: string) => void) {
    this.onEnterDoor = handler;
  }

  private readonly worldListeners = new Set<Listener>();
  private readonly stateListeners = new Set<Listener>();

  /** React → scene. */
  setWorld(world: Partial<Pick<GameBridge, "buildings" | "player" | "others">>) {
    Object.assign(this, world);
    for (const listener of this.worldListeners) listener();
  }
  onWorld(listener: Listener) {
    this.worldListeners.add(listener);
    return () => void this.worldListeners.delete(listener);
  }

  /** Scene → React. */
  setState(patch: Partial<GameState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.stateListeners) listener();
  }
  onState(listener: Listener) {
    this.stateListeners.add(listener);
    return () => void this.stateListeners.delete(listener);
  }
}
