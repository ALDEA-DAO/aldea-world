import * as Phaser from "phaser";
import type { GameBridge } from "./bridge";
import { VillageScene } from "./VillageScene";

/** Starts the village in `parent` (loaded lazily: Phaser stays out of the first render). Returns how to stop it. */
export function startGame(parent: HTMLElement, bridge: GameBridge, label: string): () => void {
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    backgroundColor: "#1d2b22",
    scale: { mode: Phaser.Scale.RESIZE, width: "100%", height: "100%" },
    scene: new VillageScene(bridge),
    banner: false,
    disableContextMenu: true,
    audio: { noAudio: true },
    input: { keyboard: false, mouse: { preventDefaultWheel: true } },
  });
  game.events.once(Phaser.Core.Events.READY, () => {
    game.canvas.tabIndex = 0;
    game.canvas.setAttribute("role", "application");
    game.canvas.setAttribute("aria-label", label);
    game.canvas.style.outlineOffset = "-3px";
  });
  // Development and end-to-end tests read the frame rate from here
  if (import.meta.env.DEV) (window as unknown as { __aldeaGame?: Phaser.Game }).__aldeaGame = game;
  return () => game.destroy(true);
}
