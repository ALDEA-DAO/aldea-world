import * as Phaser from "phaser";

export interface InputHandlers {
  minZoom: number;
  maxZoom: number;
  hasPlayer: () => boolean;
  /** A click or tap at a world pixel. */
  walkTo: (x: number, y: number) => void;
  /** One step in map tiles, from the arrows or WASD. */
  step: (dx: number, dy: number) => void;
  /** Moves the keyboard focus to the next or previous door; false when there are no more (focus leaves the game). */
  focusDoor: (direction: 1 | -1) => boolean;
  /** Enter on the focused door. */
  activateFocus: () => void;
  blurFocus: () => void;
}

// Screen directions in map tiles: up on screen is (-1, -1), right is (+1, -1)
const KEYS: Record<string, [number, number]> = {
  ArrowUp: [-1, -1], w: [-1, -1],
  ArrowDown: [1, 1], s: [1, 1],
  ArrowLeft: [-1, 1], a: [-1, 1],
  ArrowRight: [1, -1], d: [1, -1],
};
const DRAG_THRESHOLD = 8;

/**
 * The village's controls: click or tap to walk, arrows or WASD to step, Tab from door to door and Enter to go there,
 * wheel, pinch or +/- to zoom. Without a character (guests) dragging moves the camera.
 */
export function attachInput(scene: Phaser.Scene, handlers: InputHandlers) {
  const camera = scene.cameras.main;
  const canvas = scene.game.canvas;
  const zoomTo = (zoom: number) => camera.setZoom(Phaser.Math.Clamp(zoom, handlers.minZoom, handlers.maxZoom));

  // ----- pointer: tap to walk, drag to pan (guests), pinch to zoom
  scene.input.addPointer(1);
  let dragged = false;
  let pinch = 0;
  scene.input.on(Phaser.Input.Events.POINTER_DOWN, () => {
    dragged = false;
    pinch = 0;
    canvas.focus({ preventScroll: true });
  });
  scene.input.on(Phaser.Input.Events.POINTER_MOVE, (pointer: Phaser.Input.Pointer) => {
    const [first, second] = [scene.input.pointer1, scene.input.pointer2];
    if (first.isDown && second.isDown) {
      const distance = Phaser.Math.Distance.Between(first.x, first.y, second.x, second.y);
      if (pinch) zoomTo(camera.zoom * (distance / pinch));
      pinch = distance;
      dragged = true;
      return;
    }
    if (!pointer.isDown) return;
    if (Phaser.Math.Distance.Between(pointer.downX, pointer.downY, pointer.x, pointer.y) > DRAG_THRESHOLD) dragged = true;
    if (dragged && !handlers.hasPlayer()) {
      camera.scrollX -= (pointer.x - pointer.prevPosition.x) / camera.zoom;
      camera.scrollY -= (pointer.y - pointer.prevPosition.y) / camera.zoom;
    }
  });
  scene.input.on(Phaser.Input.Events.POINTER_UP, (pointer: Phaser.Input.Pointer) => {
    if (dragged) return;
    const world = camera.getWorldPoint(pointer.x, pointer.y);
    handlers.walkTo(world.x, world.y);
  });
  scene.input.on(Phaser.Input.Events.POINTER_WHEEL, (_pointer: unknown, _over: unknown, _dx: number, dy: number) => zoomTo(camera.zoom * (dy > 0 ? 0.9 : 1.1)));

  // ----- keyboard, on the canvas itself so the rest of the page keeps its own keys
  const held = new Set<string>();
  const onKeyDown = (event: KeyboardEvent) => {
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (key in KEYS) {
      held.add(key);
      event.preventDefault();
    } else if (key === "Tab") {
      if (handlers.focusDoor(event.shiftKey ? -1 : 1)) event.preventDefault();
    } else if (key === "Enter" || key === " ") {
      handlers.activateFocus();
      event.preventDefault();
    } else if (key === "Escape") {
      handlers.blurFocus();
      canvas.blur();
    } else if (key === "+" || key === "=") zoomTo(camera.zoom * 1.1);
    else if (key === "-") zoomTo(camera.zoom * 0.9);
  };
  const onKeyUp = (event: KeyboardEvent) => held.delete(event.key.length === 1 ? event.key.toLowerCase() : event.key);
  const onBlur = () => {
    held.clear();
    handlers.blurFocus();
  };
  canvas.addEventListener("keydown", onKeyDown);
  canvas.addEventListener("keyup", onKeyUp);
  canvas.addEventListener("blur", onBlur);

  const onUpdate = () => {
    if (held.size === 0) return;
    let dx = 0;
    let dy = 0;
    for (const key of held) {
      dx += KEYS[key]![0];
      dy += KEYS[key]![1];
    }
    if (dx || dy) handlers.step(Math.sign(dx), Math.sign(dy));
  };
  scene.events.on(Phaser.Scenes.Events.UPDATE, onUpdate);

  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    canvas.removeEventListener("keydown", onKeyDown);
    canvas.removeEventListener("keyup", onKeyUp);
    canvas.removeEventListener("blur", onBlur);
    scene.events.off(Phaser.Scenes.Events.UPDATE, onUpdate);
  });
}
