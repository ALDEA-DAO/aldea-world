import type * as Phaser from "phaser";

/** Below this many frames per second for longer than LITE_AFTER_MS, the village switches to lite mode. */
export const LITE_FPS = 20;
export const LITE_AFTER_MS = 1_000;
/** Loading sprites makes the first seconds jumpy on any device: they do not count. */
const GRACE_MS = 2_000;

/**
 * Watches the frame rate and calls `onLite` once when the device cannot keep up ("modo liviano"): the scene then
 * drops the particles and the ambient animations. Measured on the wall clock: Phaser's frame delta is smoothed and
 * capped, so on a slow device it adds up slower than real time.
 */
export class PerformanceWatch {
  private readonly startedAt = performance.now();
  private slowSince: number | undefined;
  private lite = false;

  constructor(
    private readonly game: Phaser.Game,
    private readonly onLite: () => void,
  ) {}

  /** Call every frame. */
  update() {
    if (this.lite) return;
    const now = performance.now();
    if (now - this.startedAt < GRACE_MS) return;
    if (this.game.loop.actualFps >= LITE_FPS) {
      this.slowSince = undefined;
      return;
    }
    this.slowSince ??= now;
    if (now - this.slowSince > LITE_AFTER_MS) {
      this.lite = true;
      this.onLite();
    }
  }
}
