import * as Phaser from "phaser";
import { assetUrl, manifest } from "./assets/manifest";
import { facing, type IsoMap, type Tile } from "./IsoMap";

/** Tiles per second: any door is reachable from the Town Center in a few seconds. */
const SPEED = 5;
const sheetKey = (characterClass: number) => `character-${characterClass}`;
/** The Founder seal's gold (the accent token, as the canvas needs it). */
const GOLD = 0xe0b34f;
const animKey = (characterClass: number, name: "idle" | "walk", row: number) => `character-${characterClass}-${name}-${row}`;

/** Loads a class's sheet and registers its animations (idle and walk, one per facing). Resolves when ready. */
export function loadCharacter(scene: Phaser.Scene, characterClass: number): Promise<void> {
  const key = sheetKey(characterClass);
  const sheet = manifest.characters[String(characterClass)];
  if (!sheet) return Promise.reject(new Error(`No character sheet for class ${characterClass}`));
  const register = () => {
    const columns = sheet.idle.length + sheet.walk.length;
    for (let row = 0; row < sheet.directions; row++) {
      for (const name of ["idle", "walk"] as const) {
        if (scene.anims.exists(animKey(characterClass, name, row))) continue;
        scene.anims.create({
          key: animKey(characterClass, name, row),
          frames: scene.anims.generateFrameNumbers(key, { frames: sheet[name].map((col) => row * columns + col) }),
          frameRate: name === "idle" ? 2 : 12,
          repeat: -1,
        });
      }
    }
  };
  if (scene.textures.exists(key)) {
    register();
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    scene.load.spritesheet(key, assetUrl(`characters/${characterClass}.webp`), { frameWidth: sheet.frameWidth, frameHeight: sheet.frameHeight });
    scene.load.once(`filecomplete-spritesheet-${key}`, () => {
      register();
      resolve();
    });
    scene.load.once(Phaser.Loader.Events.FILE_LOAD_ERROR, () => reject(new Error(`Could not load ${key}`)));
    scene.load.start();
  });
}

/**
 * A character on the map: its sprite, a ring in its tribe's color under its feet (with a gold one around it for a
 * Founder), and walking along a path of tiles.
 * Moving is local (no transactions); only entering a building is recorded on-chain.
 */
export class CharacterSprite {
  readonly sprite: Phaser.GameObjects.Sprite;
  private readonly ring: Phaser.GameObjects.Ellipse;
  private seal?: Phaser.GameObjects.Ellipse;
  private row = 0;
  private path: Tile[] = [];
  private from: Tile;
  private progress = 0;
  tile: Tile;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly map: IsoMap,
    readonly characterClass: number,
    tribeColor: number,
    tile: Tile,
    private readonly onArrive?: (tile: Tile) => void,
    founder = false,
  ) {
    const sheet = manifest.characters[String(characterClass)]!;
    this.tile = this.from = tile;
    const at = map.project(tile);
    this.ring = scene.add.ellipse(at.x, at.y, 46, 23).setStrokeStyle(4, tribeColor, 1).setFillStyle(tribeColor, 0.25);
    this.sprite = scene.add.sprite(at.x, at.y, sheetKey(characterClass)).setOrigin(sheet.anchor[0] / sheet.frameWidth, sheet.anchor[1] / sheet.frameHeight);
    this.play("idle");
    this.place(tile);
    this.setFounder(founder);
  }

  /** Shows or hides the Founder seal's gold ring. */
  setFounder(founder: boolean) {
    if (founder === Boolean(this.seal)) return;
    if (founder) {
      this.seal = this.scene.add.ellipse(this.ring.x, this.ring.y, 60, 30).setStrokeStyle(3, GOLD, 1).setDepth(this.ring.depth);
    } else {
      this.seal?.destroy();
      this.seal = undefined;
    }
  }

  get walking() {
    return this.path.length > 0;
  }

  /** Walks along `path` (tiles after the current one). A new path replaces the rest of the old one. */
  walk(path: Tile[]) {
    if (path.length === 0) return;
    if (this.walking) {
      // Finish the step in progress, then follow the new path
      this.path = [this.path[0]!, ...path];
      return;
    }
    this.path = path;
    this.progress = 0;
    this.from = this.tile;
    this.turn();
    this.play("walk");
  }

  update(deltaMs: number) {
    const next = this.path[0];
    if (!next) return;
    const diagonal = next.x !== this.from.x && next.y !== this.from.y;
    this.progress += (deltaMs / 1000) * (SPEED / (diagonal ? Math.SQRT2 : 1));
    if (this.progress < 1) {
      this.place({ x: this.from.x + (next.x - this.from.x) * this.progress, y: this.from.y + (next.y - this.from.y) * this.progress });
      return;
    }
    this.tile = this.from = next;
    this.path.shift();
    this.progress = 0;
    this.place(next);
    if (this.path.length) this.turn();
    else {
      this.play("idle");
      this.onArrive?.(next);
    }
  }

  destroy() {
    this.sprite.destroy();
    this.ring.destroy();
    this.seal?.destroy();
  }

  private turn() {
    const next = this.path[0]!;
    this.row = facing(next.x - this.from.x, next.y - this.from.y);
    this.play("walk");
  }

  private play(name: "idle" | "walk") {
    this.sprite.play(animKey(this.characterClass, name, this.row), true);
  }

  private place(tile: Tile) {
    const { x, y } = this.map.project(tile);
    this.sprite.setPosition(x, y).setDepth(y + 1);
    this.ring.setPosition(x, y).setDepth(y);
    this.seal?.setPosition(x, y).setDepth(y);
  }
}
