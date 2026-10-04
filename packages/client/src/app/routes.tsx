import { createHashRouter } from "react-router-dom";
import { Layout } from "./Layout";
import { DesignKitScreen } from "./screens/DesignKit";
import { SettingsScreen } from "./screens/Settings";
import { BuildingPanel } from "../features/buildings/BuildingPanel";
import { ListMode } from "../features/list-mode/ListMode";
import { PortalPage } from "./routes/PortalPage";
import { SoulPublic } from "./routes/SoulPublic";
import { NotFoundScreen, SimpleScreen } from "./screens/screens";
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
      { path: "/lista", element: <ListMode /> },
      { path: "/lista/:buildingSlug", element: <ListMode /> },
      { path: "/portal", element: <PortalPage /> },
      { path: "/portal/:worldId", lazy: () => import("../features/atlas/WorldDetail").then((m) => ({ Component: m.WorldDetail })) },
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
