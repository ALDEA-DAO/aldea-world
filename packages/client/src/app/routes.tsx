import { createHashRouter } from "react-router-dom";
import { Layout } from "./Layout";
import { DesignKitScreen } from "./screens/DesignKit";
import { SettingsScreen } from "./screens/Settings";
import { BuildingPanel } from "../features/buildings/BuildingPanel";
import { SoulPublic } from "./routes/SoulPublic";
import { NotFoundScreen, SimpleScreen, WorldScreen } from "./screens/screens";
import { WorldShell } from "./WorldShell";

/**
 * Hash routes: IPFS gateways do not rewrite paths, so the same build works on
 * aldea.world, any gateway and a fork's domain. Screens other than the village are placeholders until their phase lands.
 */
export const router = createHashRouter([
  {
    element: <Layout />,
    children: [
      {
        // One village for both routes: building panels open over it
        element: <WorldShell />,
        children: [
          { path: "/", element: null },
          { path: "/b/:buildingSlug", element: <BuildingPanel /> },
        ],
      },
      { path: "/lista", element: <SimpleScreen titleKey="screens.list" /> },
      { path: "/portal", element: <SimpleScreen titleKey="screens.portal" /> },
      { path: "/portal/:worldId", element: <WorldScreen /> },
      { path: "/alma/:almaId", element: <SoulPublic /> },
      { path: "/ajustes", element: <SettingsScreen /> },
      { path: "/acerca", element: <SimpleScreen titleKey="screens.about" /> },
      { path: "/terminos", element: <SimpleScreen titleKey="screens.terms" /> },
      { path: "/privacidad", element: <SimpleScreen titleKey="screens.privacy" /> },
      { path: "/ui", element: <DesignKitScreen /> },
      { path: "*", element: <NotFoundScreen /> },
    ],
  },
]);
