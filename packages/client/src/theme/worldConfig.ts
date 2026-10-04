/**
 * What makes this build a particular world: its name, its look and (through VITE_ALDEA_WORLD_ID) its entry in the
 * Atlas. A fork is this same code built with other values; the ALDEA name and art are not part of the code license,
 * so a fork sets its own.
 */
export const WORLD_THEMES = ["nocturna"] as const;
export type WorldTheme = (typeof WORLD_THEMES)[number];

const theme = import.meta.env.VITE_WORLD_THEME as string | undefined;

export const worldConfig = {
  name: (import.meta.env.VITE_WORLD_NAME as string | undefined) || "ALDEA World",
  /** A palette in src/styles/themes; undefined is ALDEA's own. */
  theme: WORLD_THEMES.includes(theme as WorldTheme) ? (theme as WorldTheme) : undefined,
};

/** Names the page after the world and switches its palette on. */
export function applyWorld() {
  document.title = worldConfig.name;
  if (worldConfig.theme) document.documentElement.dataset.world = worldConfig.theme;
}
