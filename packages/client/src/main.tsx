import "@fontsource/alegreya/500.css";
import "@fontsource/alegreya/700.css";
import "@fontsource/alegreya/800.css";
import "@fontsource/alegreya-sc/700.css";
import "@fontsource/alegreya-sans/400.css";
import "@fontsource/alegreya-sans/500.css";
import "@fontsource/alegreya-sans/700.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/600.css";
import "./styles/globals.css";
import "./lib/i18n";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { router } from "./app/routes";
import { ToastProvider } from "./components/ui/Toast";
import { applyTheme, getThemePreference } from "./lib/theme";

applyTheme(getThemePreference());

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

// Providers grow in Phase 1: AlmaAuthProvider (OIDC + Turnkey) → SmartAccountProvider → MUDProvider → router.
createRoot(root).render(
  <StrictMode>
    <ToastProvider>
      <RouterProvider router={router} />
    </ToastProvider>
  </StrictMode>,
);
