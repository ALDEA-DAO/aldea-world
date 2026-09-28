import { createHashRouter } from "react-router-dom";
import { Layout } from "./Layout";
import { DesignKitScreen } from "./screens/DesignKit";
import { SettingsScreen } from "./screens/Settings";
import {
  BuildingScreen,
  NotFoundScreen,
  SimpleScreen,
  SoulScreen,
  VillageScreen,
  WorldScreen,
} from "./screens/screens";

/**
 * Hash routes: IPFS gateways do not rewrite paths, so the same build works on
 * aldea.world, any gateway and a fork's domain. Screens are placeholders until their phase lands.
 */
export const router = createHashRouter([
  {
    element: <Layout />,
    children: [
      { path: "/", element: <VillageScreen /> },
      { path: "/b/:buildingSlug", element: <BuildingScreen /> },
      { path: "/lista", element: <SimpleScreen titleKey="screens.list" /> },
      { path: "/portal", element: <SimpleScreen titleKey="screens.portal" /> },
      { path: "/portal/:worldId", element: <WorldScreen /> },
      { path: "/alma/:almaId", element: <SoulScreen /> },
      { path: "/ajustes", element: <SettingsScreen /> },
      { path: "/acerca", element: <SimpleScreen titleKey="screens.about" /> },
      { path: "/terminos", element: <SimpleScreen titleKey="screens.terms" /> },
      { path: "/privacidad", element: <SimpleScreen titleKey="screens.privacy" /> },
      { path: "/ui", element: <DesignKitScreen /> },
      { path: "*", element: <NotFoundScreen /> },
    ],
  },
]);
