import { useParams } from "react-router-dom";
import { SoulRegistry } from "../../features/buildings/SoulRegistry";

/**
 * `#/alma/:almaId`: anyone's soul as the Soul Registry shows it to everyone: identifier, type, status, character,
 * tribe and seals, each with its on-chain evidence. Only public facts (private bindings never reach this view).
 */
export function SoulPublic() {
  const { almaId } = useParams();
  return <SoulRegistry almaId={almaId} />;
}
