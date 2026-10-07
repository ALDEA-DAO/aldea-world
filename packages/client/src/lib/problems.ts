import i18n from "./i18n";

/**
 * The copy for a problem the ALMA Resolver answered with (its stable `code`): what this screen says about it when it
 * has something more precise (`specific`), else what the village says about that code anywhere (`problems.<code>`).
 * The Resolver's own English titles are never shown.
 */
export function problemCopy(code: string, specific: Record<string, string> = {}): string {
  return specific[code] ?? (i18n.exists(`problems.${code}`) ? `problems.${code}` : "problems.unknown");
}
