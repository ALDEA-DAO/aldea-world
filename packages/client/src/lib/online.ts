import { useSyncExternalStore } from "react";

const subscribe = (notify: () => void) => {
  window.addEventListener("online", notify);
  window.addEventListener("offline", notify);
  return () => {
    window.removeEventListener("online", notify);
    window.removeEventListener("offline", notify);
  };
};

/** Whether the browser says it is online (`navigator.onLine` and its online/offline events). */
export const useOnline = () => useSyncExternalStore(subscribe, () => navigator.onLine);
