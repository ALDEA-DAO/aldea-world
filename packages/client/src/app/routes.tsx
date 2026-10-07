import { createHashRouter } from "react-router-dom";
import { Layout } from "./Layout";
import { DesignKitScreen } from "./screens/DesignKit";
import { BuildingPanel } from "../features/buildings/BuildingPanel";
import { ListMode } from "../features/list-mode/ListMode";
import { PortalPage } from "./routes/PortalPage";
import { SoulPublic } from "./routes/SoulPublic";
import { NotFoundScreen } from "./screens/screens";
import { WorldShell } from "./WorldShell";

/**
 * Hash routes: IPFS gateways do not rewrite paths, so the same build works on
 * aldea.world, any gateway and a fork's domain.
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
      { path: "/ajustes", lazy: () => import("../features/settings/Settings").then((m) => ({ Component: m.SettingsScreen })) },
      { path: "/acerca", lazy: () => import("./routes/About").then((m) => ({ Component: m.About })) },
      { path: "/terminos", lazy: () => import("./routes/Terms").then((m) => ({ Component: m.Terms })) },
      { path: "/privacidad", lazy: () => import("./routes/Privacy").then((m) => ({ Component: m.Privacy })) },
      { path: "/ui", element: <DesignKitScreen /> },
      { path: "*", element: <NotFoundScreen /> },
    ],
  },
]);
