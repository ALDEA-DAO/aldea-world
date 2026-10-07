export type MotionPreference = "system" | "reduced";
const STORAGE_KEY = "aldea.motion";

/** "system" follows prefers-reduced-motion; "reduced" turns motion down whatever the system says. */
export function getMotionPreference(): MotionPreference {
  try {
    return localStorage.getItem(STORAGE_KEY) === "reduced" ? "reduced" : "system";
  } catch {
    return "system";
  }
}

/** The styles read `data-motion` on the root next to the system's own media query. */
export function applyMotion(preference: MotionPreference) {
  if (preference === "reduced") document.documentElement.dataset.motion = "reduced";
  else delete document.documentElement.dataset.motion;
}

export function setMotionPreference(preference: MotionPreference) {
  applyMotion(preference);
  try {
    if (preference === "system") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    // storage unavailable: the choice lasts for this session only
  }
}
