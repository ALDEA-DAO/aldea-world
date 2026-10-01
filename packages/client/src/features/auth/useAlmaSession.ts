import { useContext } from "react";
import { AlmaSessionContext, type AlmaSessionValue } from "./AlmaAuthProvider";

/** The ALMA session: status, soul, the player's account and sign in/out. Must be used under `AlmaAuthProvider`. */
export function useAlmaSession(): AlmaSessionValue {
  const value = useContext(AlmaSessionContext);
  if (!value) throw new Error("useAlmaSession must be used inside AlmaAuthProvider");
  return value;
}
