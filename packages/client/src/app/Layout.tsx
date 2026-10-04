import { Outlet } from "react-router-dom";
import { HudTopBar } from "../components/hud/HudTopBar";
import { StatusBanners } from "../components/hud/StatusBanners";
import { AuthReturnState } from "../features/auth/SignInWithAlma";
import { usePresence } from "../lib/presence";

/** The app's frame: the top HUD over every screen, the global states (maintenance, offline) and the current route. */
export function Layout() {
  usePresence();
  return (
    <div className="flex min-h-dvh flex-col">
      <HudTopBar />
      <StatusBanners />
      <AuthReturnState />
      <main className="flex flex-1 flex-col">
        <Outlet />
      </main>
    </div>
  );
}
