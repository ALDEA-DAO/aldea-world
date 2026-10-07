import "@fontsource/alegreya/latin-500.css";
import "@fontsource/alegreya/latin-700.css";
import "@fontsource/alegreya/latin-800.css";
import "@fontsource/alegreya-sc/latin-700.css";
import "@fontsource/alegreya-sans/latin-400.css";
import "@fontsource/alegreya-sans/latin-500.css";
import "@fontsource/alegreya-sans/latin-700.css";
import "@fontsource/jetbrains-mono/latin-400.css";
import "@fontsource/jetbrains-mono/latin-600.css";
import "./styles/globals.css";
import "./styles/themes/nocturna.css";
import "./lib/i18n";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { router } from "./app/routes";
import { ToastProvider } from "./components/ui/Toast";
import { AlmaAuthProvider } from "./features/auth/AlmaAuthProvider";
import { MudProvider } from "./mud/store";
import { applyMotion, getMotionPreference } from "./lib/motion";
import { startErrorReports } from "./lib/sentry";
import { applyTheme, getThemePreference } from "./lib/theme";
import { applyWorld } from "./theme/worldConfig";

applyTheme(getThemePreference());
applyMotion(getMotionPreference());
startErrorReports();
applyWorld();

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

// Providers: Sign in with ALMA (OIDC + custody + smart account) → the World (MUD sync + system calls) → router.
createRoot(root).render(
  <StrictMode>
    <ToastProvider>
      <AlmaAuthProvider>
        <MudProvider>
          <RouterProvider router={router} />
        </MudProvider>
      </AlmaAuthProvider>
    </ToastProvider>
  </StrictMode>,
);
