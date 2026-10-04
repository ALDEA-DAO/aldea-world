import { keccak256, toBytes, type Hex } from "viem";

/**
 * Canonical catalogs. Array order is the on-chain enum order in
 * packages/contracts/mud.config.ts: never reorder, only append.
 */

export interface Localized {
  es: string;
  en: string;
}

export const CHARACTER_CLASSES = [
  "Archer",
  "Alchemist",
  "Artisan",
  "Blacksmith",
  "Chef",
  "Magician",
  "Merchant",
  "Priest",
  "Tailor",
  "Rebel",
  "Warrior",
] as const;
export type CharacterClassEnum = (typeof CHARACTER_CLASSES)[number];

export const TRIBES = ["Amazonians", "Himalayans", "Poseidons", "Raes", "Tropicals"] as const;
export type TribeEnum = (typeof TRIBES)[number];

export const BUILDING_KINDS = ["TownCenter", "Portal", "SoulRegistry", "Council", "VelumArchive", "NpcForge"] as const;
export type BuildingKindEnum = (typeof BUILDING_KINDS)[number];

export interface CharacterClassInfo {
  index: number;
  enum: CharacterClassEnum;
  name: Localized;
  /** game-icons.net icon name */
  icon: string;
  /** Narrative only in the MVP: one line on the class card */
  affinity: Localized;
}

export const classes: readonly CharacterClassInfo[] = [
  { index: 0, enum: "Archer", name: { es: "Arquero", en: "Archer" }, icon: "bow", affinity: { es: "Portal / exploración", en: "Portal / exploration" } },
  { index: 1, enum: "Alchemist", name: { es: "Alquimista", en: "Alchemist" }, icon: "flask", affinity: { es: "Archivo Velum", en: "Velum Archive" } },
  { index: 2, enum: "Artisan", name: { es: "Artesano", en: "Artisan" }, icon: "hammer", affinity: { es: "Forja de NPCs", en: "NPC Forge" } },
  { index: 3, enum: "Blacksmith", name: { es: "Herrero", en: "Blacksmith" }, icon: "anvil", affinity: { es: "Forja de NPCs", en: "NPC Forge" } },
  { index: 4, enum: "Chef", name: { es: "Cocinero", en: "Chef" }, icon: "chef-hat", affinity: { es: "Hogares de las tribus", en: "Tribe hearths" } },
  { index: 5, enum: "Magician", name: { es: "Mago", en: "Magician" }, icon: "wand", affinity: { es: "Archivo Velum", en: "Velum Archive" } },
  { index: 6, enum: "Merchant", name: { es: "Mercader", en: "Merchant" }, icon: "scales", affinity: { es: "Portal / comercio", en: "Portal / trade" } },
  { index: 7, enum: "Priest", name: { es: "Sacerdote", en: "Priest" }, icon: "praying-hands", affinity: { es: "Consejo", en: "Council" } },
  { index: 8, enum: "Tailor", name: { es: "Sastre", en: "Tailor" }, icon: "needle", affinity: { es: "Registro de Almas", en: "Soul Registry" } },
  { index: 9, enum: "Rebel", name: { es: "Rebelde", en: "Rebel" }, icon: "fist", affinity: { es: "Consejo (objeciones)", en: "Council (objections)" } },
  { index: 10, enum: "Warrior", name: { es: "Guerrero", en: "Warrior" }, icon: "sword", affinity: { es: "Defensa de la tribu", en: "Tribe defense" } },
];

export interface TribeInfo {
  index: number;
  enum: TribeEnum;
  slug: string;
  name: Localized;
  biome: Localized;
  /** game-icons.net icon name for the biome */
  icon: string;
  almaOrgId: string;
  /** CSS custom property defined in packages/client/src/styles/tokens.css */
  colorToken: `--tribe-${string}`;
}

export const tribes: readonly TribeInfo[] = [
  { index: 0, enum: "Amazonians", slug: "amazonicos", name: { es: "Amazónicos", en: "Amazonians" }, biome: { es: "Selva", en: "Jungle" }, icon: "palm-tree", almaOrgId: "alma:main:org:tribu-amazonicos", colorToken: "--tribe-amazonians" },
  { index: 1, enum: "Himalayans", slug: "himalayos", name: { es: "Himalayos", en: "Himalayans" }, biome: { es: "Montaña y glaciar", en: "Mountain and glacier" }, icon: "peaks", almaOrgId: "alma:main:org:tribu-himalayos", colorToken: "--tribe-himalayans" },
  { index: 2, enum: "Poseidons", slug: "poseidones", name: { es: "Poseidones", en: "Poseidons" }, biome: { es: "Océano", en: "Ocean" }, icon: "big-wave", almaOrgId: "alma:main:org:tribu-poseidones", colorToken: "--tribe-poseidons" },
  { index: 3, enum: "Raes", slug: "raes", name: { es: "Raes", en: "Raes" }, biome: { es: "Sol y desierto", en: "Sun and desert" }, icon: "sun", almaOrgId: "alma:main:org:tribu-raes", colorToken: "--tribe-raes" },
  { index: 4, enum: "Tropicals", slug: "tropicales", name: { es: "Tropicales", en: "Tropicals" }, biome: { es: "Trópico y coral", en: "Tropics and coral" }, icon: "coral", almaOrgId: "alma:main:org:tribu-tropicales", colorToken: "--tribe-tropicals" },
];

/** The world's own ALMA organizations. */
export const WORLD_ORGS = {
  aldeaWorld: "alma:main:org:aldea-world",
  aldeaDao: "alma:main:org:aldea-dao",
  adasouls: "alma:main:org:adasouls",
} as const;

/** Orgs anchored on-chain by packages/council/script/Deploy.s.sol, in the same order. */
export const ANCHORED_ORG_IDS = [...tribes.map((t) => t.almaOrgId), WORLD_ORGS.aldeaWorld] as const;

export interface BuildingInfo {
  slug: string;
  /** keccak256("aldea.building.<slug>") */
  id: Hex;
  kind: BuildingKindEnum;
  /** Hash route segment: #/b/<routeSlug> */
  routeSlug: string;
  door: { x: number; y: number };
  isOpen: boolean;
  underConstruction: boolean;
  name: Localized;
  icon: string;
  /** Only for buildings under construction: what it will do, the AdaSouls rail it demonstrates and an honest date */
  construction?: { willDo: Localized; rail: Localized; estimated: Localized };
}

export const buildingId = (slug: string): Hex => keccak256(toBytes(`aldea.building.${slug}`));

// TODO(founder): confirm the estimated opening dates for the Velum Archive and the NPC Forge (Phase 6).
const PHASE_6_ESTIMATE: Localized = { es: "Fase 6 · fecha por confirmar", en: "Phase 6 · date to be confirmed" };

export const buildings: readonly BuildingInfo[] = [
  { slug: "town-center", id: buildingId("town-center"), kind: "TownCenter", routeSlug: "centro-urbano", door: { x: 20, y: 20 }, isOpen: true, underConstruction: false, name: { es: "Centro Urbano", en: "Town Center" }, icon: "castle" },
  { slug: "portal", id: buildingId("portal"), kind: "Portal", routeSlug: "portal", door: { x: 27, y: 15 }, isOpen: true, underConstruction: false, name: { es: "Portal de los Mundos", en: "Portal of Worlds" }, icon: "magic-portal" },
  { slug: "soul-registry", id: buildingId("soul-registry"), kind: "SoulRegistry", routeSlug: "registro-de-almas", door: { x: 13, y: 15 }, isOpen: true, underConstruction: false, name: { es: "Registro de Almas", en: "Soul Registry" }, icon: "book-cover" },
  { slug: "council", id: buildingId("council"), kind: "Council", routeSlug: "consejo", door: { x: 20, y: 11 }, isOpen: true, underConstruction: false, name: { es: "Consejo", en: "Council" }, icon: "greek-temple" },
  {
    slug: "velum-archive",
    id: buildingId("velum-archive"),
    kind: "VelumArchive",
    routeSlug: "archivo-velum",
    door: { x: 12, y: 26 },
    isOpen: true,
    underConstruction: true,
    name: { es: "Archivo Velum", en: "Velum Archive" },
    icon: "scroll-unfurled",
    construction: {
      willDo: { es: "Credenciales privadas en Midnight con Velum.", en: "Private credentials on Midnight with Velum." },
      rail: { es: "Velum: credenciales con privacidad.", en: "Velum: privacy-preserving credentials." },
      estimated: PHASE_6_ESTIMATE,
    },
  },
  {
    slug: "npc-forge",
    id: buildingId("npc-forge"),
    kind: "NpcForge",
    routeSlug: "forja",
    door: { x: 28, y: 26 },
    isOpen: true,
    underConstruction: true,
    name: { es: "Forja de NPCs", en: "NPC Forge" },
    icon: "anvil-impact",
    construction: {
      willDo: { es: "Crear NPCs con alma de agente.", en: "Create NPCs with an agent soul." },
      rail: { es: "ALMA para agentes (Soul Registry).", en: "ALMA for agents (Soul Registry)." },
      estimated: PHASE_6_ESTIMATE,
    },
  },
];

/** Where a would-be founder of the second world starts. */
export const FORK_GUIDE_URL = "https://github.com/ALDEA-DAO/aldea-world#forking-aldea-world";

// TODO(founder): set the Genesis Charter opening date ; the Council panel reads it.
export const COUNCIL_OPENS_AT: string | null = null;

export const classByIndex = (i: number): CharacterClassInfo | undefined => classes[i];
export const tribeByIndex = (i: number): TribeInfo | undefined => tribes[i];
export const buildingById = (id: Hex): BuildingInfo | undefined =>
  buildings.find((b) => b.id.toLowerCase() === id.toLowerCase());
export const buildingByRoute = (routeSlug: string): BuildingInfo | undefined =>
  buildings.find((b) => b.routeSlug === routeSlug);
