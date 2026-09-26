export type ThemePreference = "light" | "dark" | "system";
const STORAGE_KEY = "aldea.theme";

/** Reads the saved theme; "system" leaves data-theme unset so tokens.css follows prefers-color-scheme. */
export function getThemePreference(): ThemePreference {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

export function applyTheme(preference: ThemePreference) {
  const root = document.documentElement;
  if (preference === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", preference);
}

export function setThemePreference(preference: ThemePreference) {
  applyTheme(preference);
  try {
    if (preference === "system") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    // storage unavailable: the choice lasts for this session only
  }
}
