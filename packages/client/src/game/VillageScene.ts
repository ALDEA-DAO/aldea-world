import { tribeByIndex } from "@aldea/shared/catalog";
import * as Phaser from "phaser";
import { assetUrl, buildingSpriteKey, manifest } from "./assets/manifest";
import type { GameBridge, WorldBuilding, WorldCharacter } from "./bridge";
import { CharacterSprite, loadCharacter } from "./CharacterSprite";
import { buildingAt, doorAt, footprint } from "./doors";
import { attachInput } from "./input";
import { IsoMap, type Tile, type TiledMap } from "./IsoMap";
import { Pathfinding } from "./Pathfinding";
import { PerformanceWatch } from "./performance";

const MAP_URL = new URL("./assets/maps/aldea.tmj", import.meta.url).href;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2;
const MAX_OTHERS = 60;

/** The CSS color of a tribe (`--tribe-*`, so the game follows the theme), as a number for Phaser. */
function tribeColor(tribe: number): number {
  const token = tribeByIndex(tribe)?.colorToken;
  const css = token ? getComputedStyle(document.documentElement).getPropertyValue(token).trim() : "";
  return /^#[0-9a-f]{6}$/i.test(css) ? Number.parseInt(css.slice(1), 16) : 0xffffff;
}

/**
 * The village: the isometric map, the buildings where the World says they are, the player's character and the other
 * souls. Walking is local; the scene tells React (through the bridge) which door the player is standing at.
 */
export class VillageScene extends Phaser.Scene {
  private map!: IsoMap;
  private paths!: Pathfinding;
  private buildingSprites = new Map<string, Phaser.GameObjects.Image>();
  private placed: WorldBuilding[] = [];
  private player?: CharacterSprite;
  private others = new Map<number, CharacterSprite>();
  private focus?: Phaser.GameObjects.Ellipse;
  private focused = -1;
  private syncing = false;
  private syncAgain = false;
  private emitters: Phaser.GameObjects.Particles.ParticleEmitter[] = [];
  private performance?: PerformanceWatch;
  private lite = false;

  constructor(private readonly bridge: GameBridge) {
    super("village");
  }

  preload() {
    this.load.json("map", MAP_URL);
    this.load.spritesheet("ground", assetUrl("tiles/ground.png"), { frameWidth: manifest.tile.width, frameHeight: manifest.tile.height });
    for (const key of Object.keys(manifest.decorations)) this.load.image(`decor-${key}`, assetUrl(`decor/${key}.webp`));
    for (const key of Object.keys(manifest.buildings)) this.load.image(`building-${key}`, assetUrl(`buildings/${key}.webp`));
    this.load.once(Phaser.Loader.Events.FILE_LOAD_ERROR, (file: { key: string }) => this.bridge.setState({ failed: `Could not load ${file.key}` }));
  }

  create() {
    this.map = new IsoMap(this.cache.json.get("map") as TiledMap);
    this.paths = new Pathfinding(this.map);
    this.drawGround();
    this.drawScenery();
    this.ambience();

    const bounds = this.map.bounds();
    const camera = this.cameras.main;
    camera.setBounds(bounds.x - 200, bounds.y - 300, bounds.width + 400, bounds.height + 500);
    camera.setZoom(this.scale.width < 700 ? 0.6 : 0.9);
    const centre = this.map.project(this.map.doors.get("town-center") ?? { x: this.map.width / 2, y: this.map.height / 2 });
    camera.centerOn(centre.x, centre.y);

    attachInput(this, {
      minZoom: MIN_ZOOM,
      maxZoom: MAX_ZOOM,
      hasPlayer: () => Boolean(this.player),
      walkTo: (px, py) => this.walkTo(this.map.unproject(px, py)),
      step: (dx, dy) => this.step(dx, dy),
      focusDoor: (direction) => this.focusDoor(direction),
      activateFocus: () => this.activateFocus(),
      blurFocus: () => this.blurFocus(),
    });

    const stop = this.bridge.onWorld(() => void this.sync());
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, stop);
    this.performance = new PerformanceWatch(this.game, () => this.goLite());
    void this.sync();
  }

  update(_time: number, delta: number) {
    this.player?.update(delta);
    this.performance?.update();
    this.bridge.state.fps = this.game.loop.actualFps;
  }

  // ----- the static world

  private drawGround() {
    const { tileWidth, tileHeight } = this.map;
    const blitter = this.add.blitter(0, 0, "ground").setDepth(-1);
    this.map.ground.forEach((frame, i) => {
      if (frame < 0) return;
      const { x, y } = this.map.project({ x: i % this.map.width, y: Math.floor(i / this.map.width) });
      blitter.create(x - tileWidth / 2, y - tileHeight / 2, frame);
    });
  }

  private drawScenery() {
    for (const { key, tile } of this.map.decoration) {
      const info = manifest.decorations[key];
      if (!info) continue;
      const { x, y } = this.map.project(tile);
      this.add.image(x, y, `decor-${key}`).setOrigin(info.anchor[0] / info.width, info.anchor[1] / info.height).setDepth(y);
    }
  }

  /** Smoke over the Town Center and embers at its plaza. */
  private ambience() {
    const dot = this.make.graphics({}, false).fillStyle(0xffffff, 1).fillCircle(8, 8, 8);
    dot.generateTexture("dot", 16, 16);
    dot.destroy();
    const door = this.map.doors.get("town-center");
    if (!door) return;
    const keep = this.map.project({ x: door.x, y: door.y - 2 });
    const smoke = this.add
      .particles(keep.x, keep.y - 330, "dot", { speedY: { min: -30, max: -14 }, speedX: { min: -8, max: 12 }, scale: { start: 0.5, end: 1.6 }, alpha: { start: 0.35, end: 0 }, tint: 0xd8d2c8, lifespan: 4200, frequency: 420 })
      .setDepth(1e6);
    const plaza = this.map.project({ x: door.x, y: door.y + 3 });
    const embers = this.add
      .particles(plaza.x, plaza.y - 20, "dot", { speedY: { min: -46, max: -22 }, speedX: { min: -14, max: 14 }, scale: { start: 0.22, end: 0 }, alpha: { start: 0.9, end: 0 }, tint: [0xffc56b, 0xff8a3c], lifespan: 2600, frequency: 300, blendMode: "ADD" })
      .setDepth(1e6);
    this.emitters = [smoke, embers];
  }

  /** Lite mode: no particles and no ambient animation (the other souls stand still); the player still walks. */
  private goLite() {
    this.lite = true;
    for (const emitter of this.emitters) emitter.stop(true).setVisible(false);
    for (const other of this.others.values()) other.sprite.anims.pause();
    this.bridge.setState({ lite: true });
  }

  // ----- the world from the chain

  /** Applies what React knows: buildings, the player's character, the other souls. */
  private async sync() {
    // A change that arrives while sprites are loading is applied right after, never dropped
    if (this.syncing) {
      this.syncAgain = true;
      return;
    }
    this.syncing = true;
    try {
      do {
        this.syncAgain = false;
        this.placeBuildings(this.bridge.buildings);
        await this.placePlayer();
        // The village is shown as soon as the buildings and your character are there; the crowd loads after
        if (!this.bridge.state.ready) this.bridge.setState({ ready: true });
        await this.placeOthers(this.bridge.others.slice(0, MAX_OTHERS));
      } while (this.syncAgain);
    } catch (err) {
      this.bridge.setState({ failed: err instanceof Error ? err.message : String(err) });
    } finally {
      this.syncing = false;
    }
  }

  private placeBuildings(buildings: WorldBuilding[]) {
    const signature = (list: WorldBuilding[]) => list.map((b) => `${b.slug}:${b.door.x},${b.door.y}:${b.underConstruction}`).join("|");
    if (signature(buildings) === signature(this.placed)) return;
    for (const [slug, sprite] of this.buildingSprites) {
      sprite.destroy();
      this.blockFootprint(this.placed.find((b) => b.slug === slug), false);
    }
    this.buildingSprites.clear();
    for (const building of buildings) {
      const key = buildingSpriteKey(building.slug, building.underConstruction);
      const info = manifest.buildings[key];
      if (!info) continue;
      const origin = { x: building.door.x, y: building.door.y - 1 };
      const { x, y } = this.map.project(origin);
      // Sorted by its front-most tile, so characters walking in front of it are drawn over it
      const front = Math.max(...info.footprint.map(([dx, dy]) => this.map.project({ x: origin.x + dx, y: origin.y + dy }).y));
      this.buildingSprites.set(building.slug, this.add.image(x, y, `building-${key}`).setOrigin(info.anchor[0] / info.width, info.anchor[1] / info.height).setDepth(front));
      this.blockFootprint(building, true);
    }
    this.placed = buildings;
    this.paths.refresh();
  }

  private blockFootprint(building: WorldBuilding | undefined, blocked: boolean) {
    if (!building) return;
    for (const tile of footprint(building)) this.map.setBlocked(tile, blocked);
    this.map.setBlocked(building.door, false);
  }

  private async placePlayer() {
    const wanted = this.bridge.player;
    if (!wanted) {
      this.player?.destroy();
      this.player = undefined;
      this.cameras.main.stopFollow();
      this.bridge.setState({ door: undefined, playerTile: undefined });
      return;
    }
    if (this.player?.characterClass === wanted.characterClass) {
      this.player.setFounder(Boolean(wanted.founder));
      return;
    }
    await loadCharacter(this, wanted.characterClass);
    this.player?.destroy();
    const start = this.startTile();
    this.player = new CharacterSprite(this, this.map, wanted.characterClass, tribeColor(wanted.tribe), start, (tile) => this.arrived(tile), wanted.founder);
    this.cameras.main.startFollow(this.player.sprite, true, 0.12, 0.12);
    this.arrived(start);
  }

  /** Where the player was in this tab, or in front of the Town Center, where every soul is born. */
  private startTile(): Tile {
    try {
      const saved = JSON.parse(sessionStorage.getItem("aldea:tile") ?? "null") as Tile | null;
      if (saved && Number.isInteger(saved.x) && Number.isInteger(saved.y) && this.map.walkable(saved)) return saved;
    } catch {
      // nothing remembered
    }
    return this.plaza();
  }

  private plaza(): Tile {
    const door = this.placed.find((b) => b.slug === "town-center")?.door ?? this.map.doors.get("town-center") ?? { x: 20, y: 20 };
    return { x: door.x, y: door.y + 1 };
  }

  private async placeOthers(characters: WorldCharacter[]) {
    const keep = new Set(characters.map((c) => c.id));
    for (const [id, sprite] of this.others) {
      if (keep.has(id)) continue;
      sprite.destroy();
      this.others.delete(id);
    }
    for (const character of characters) {
      const present = this.others.get(character.id);
      if (present) {
        present.setFounder(Boolean(character.founder));
        continue;
      }
      await loadCharacter(this, character.characterClass);
      const sprite = new CharacterSprite(this, this.map, character.characterClass, tribeColor(character.tribe), this.standingSpot(character), undefined, character.founder);
      if (this.lite) sprite.sprite.anims.pause();
      this.others.set(character.id, sprite);
    }
  }

  /** Other souls stand near the door of the building they were last seen in (the Town Center's plaza otherwise). */
  private standingSpot(character: WorldCharacter): Tile {
    const door = this.placed.find((b) => b.slug === character.at)?.door ?? this.plaza();
    for (let ring = 1; ring < 6; ring++) {
      for (let n = 0; n < ring * 8; n++) {
        // A deterministic spiral per character, so everybody sees the same crowd
        const angle = ((character.id * 2.399963 + n) % (ring * 8)) * ((Math.PI * 2) / (ring * 8));
        const tile = { x: door.x + Math.round(Math.cos(angle) * ring), y: door.y + 1 + Math.round(Math.sin(angle) * ring) };
        const taken = [...this.others.values()].some((o) => o.tile.x === tile.x && o.tile.y === tile.y);
        if (this.map.walkable(tile) && !taken && !this.placed.some((b) => b.door.x === tile.x && b.door.y === tile.y)) return tile;
      }
    }
    return door;
  }

  // ----- walking

  private walkTo(target: Tile) {
    // Clicking a building walks to its door
    const building = buildingAt(this.placed, target);
    if (!this.player) {
      // Guests have no character: choosing a building offers to look inside
      this.bridge.setState({ door: building?.slug });
      return;
    }
    const path = this.paths.find(this.player.tile, building?.door ?? target);
    if (path.length) {
      this.bridge.setState({ door: undefined });
      this.player.walk(path);
    }
  }

  private step(dx: number, dy: number) {
    if (!this.player || this.player.walking) return;
    const next = { x: this.player.tile.x + dx, y: this.player.tile.y + dy };
    if (this.map.walkable(next)) {
      this.bridge.setState({ door: undefined });
      this.player.walk([next]);
    }
  }

  private arrived(tile: Tile) {
    this.bridge.setState({ door: doorAt(this.placed, tile)?.slug, playerTile: tile });
    try {
      sessionStorage.setItem("aldea:tile", JSON.stringify(tile));
    } catch {
      // private mode: the position is simply not remembered
    }
  }

  /** Keyboard: Tab moves a visible focus from door to door, then leaves the game. */
  private focusDoor(direction: 1 | -1): boolean {
    const next = this.focused < 0 ? (direction === 1 ? 0 : this.placed.length - 1) : this.focused + direction;
    if (next < 0 || next >= this.placed.length) {
      this.blurFocus();
      return false;
    }
    this.focused = next;
    const building = this.placed[next]!;
    const { x, y } = this.map.project(building.door);
    this.focus ??= this.add.ellipse(x, y, 96, 48).setStrokeStyle(5, 0xffd27a, 1).setDepth(1e6 - 1);
    this.focus.setPosition(x, y).setVisible(true);
    if (!this.player) {
      this.cameras.main.pan(x, y, 300);
      this.bridge.setState({ door: building.slug });
    }
    return true;
  }

  /** Enter: walks to the focused door, or goes in when already standing at it (guests look inside right away). */
  private activateFocus() {
    const building = this.placed[this.focused] ?? this.placed.find((b) => b.slug === this.bridge.state.door);
    if (!building) return;
    const there = !this.player || (this.player.tile.x === building.door.x && this.player.tile.y === building.door.y);
    if (there) this.bridge.onEnterDoor?.(building.slug);
    else this.walkTo(building.door);
  }

  private blurFocus() {
    this.focused = -1;
    this.focus?.setVisible(false);
  }
}
