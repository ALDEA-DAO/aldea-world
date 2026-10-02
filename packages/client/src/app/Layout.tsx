import { Outlet } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { HudTopBar } from "../components/hud/HudTopBar";
import { AuthReturnState } from "../features/auth/SignInWithAlma";
import { useWorldPaused } from "../mud/store";

/** The app's frame: the top HUD over every screen, the pause notice and the current route. */
export function Layout() {
  const { t } = useTranslation();
  const paused = useWorldPaused();
  return (
    <div className="flex min-h-dvh flex-col">
      <HudTopBar />
      {paused && (
        <p role="status" className="bg-warning px-4 py-2 text-center text-sm">
          {t("world.paused")}
        </p>
      )}
      <AuthReturnState />
      <main className="flex flex-1 flex-col">
        <Outlet />
      </main>
    </div>
  );
}
