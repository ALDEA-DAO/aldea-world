import clsx from "clsx";
import { List, Menu, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link, NavLink } from "react-router-dom";
import { SignInWithAlma } from "../../features/auth/SignInWithAlma";

const menu = [
  { to: "/", key: "nav.village", end: true },
  { to: "/lista", key: "nav.list" },
  { to: "/portal", key: "nav.portal" },
  { to: "/ajustes", key: "nav.settings" },
  { to: "/acerca", key: "nav.about" },
  { to: "/ui", key: "nav.designKit" },
] as const;

/**
 * The top of the HUD: the world's name (back to the village), the version badge's slot, List mode, the player's soul
 * (or "Entrar") and the menu with the rest of the routes.
 */
export function HudTopBar({ versionBadge }: { versionBadge?: ReactNode }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <header className="relative z-30 flex h-hud-top shrink-0 items-center gap-2 bg-wood px-3 text-on-wood shadow-paper sm:gap-3 sm:px-4">
      <Link to="/" aria-label={t("hud.home")} className="inline-flex min-h-11 items-center font-display text-xl whitespace-nowrap">
        {t("app.name")}
      </Link>
      {versionBadge}
      <span className="flex-1" />
      <Link to="/lista" title={t("nav.list")} className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 text-sm whitespace-nowrap hover:bg-black/20">
        <List aria-hidden className="size-4" />
        <span className="hidden md:inline">{t("nav.list")}</span>
        <span className="sr-only md:hidden">{t("nav.list")}</span>
      </Link>
      <SignInWithAlma />
      <div className="relative" onKeyDown={(e) => e.key === "Escape" && setOpen(false)}>
        <button
          type="button"
          aria-expanded={open}
          aria-controls="hud-menu"
          aria-label={open ? t("hud.closeMenu") : t("hud.menu")}
          onClick={() => setOpen((o) => !o)}
          className="inline-flex size-11 items-center justify-center rounded-md hover:bg-black/20"
        >
          {open ? <X aria-hidden className="size-5" /> : <Menu aria-hidden className="size-5" />}
        </button>
        {open && (
          <>
            <button type="button" tabIndex={-1} aria-hidden className="fixed inset-0 cursor-default" onClick={() => setOpen(false)} />
            <nav id="hud-menu" aria-label={t("hud.menu")} className="absolute top-full right-0 mt-2 flex w-56 flex-col rounded-md bg-wood p-1 shadow-raised">
              {menu.map((l) => (
                <NavLink
                  key={l.to}
                  to={l.to}
                  end={"end" in l ? l.end : false}
                  onClick={() => setOpen(false)}
                  className={({ isActive }) => clsx("inline-flex min-h-11 items-center rounded-md px-3 text-sm hover:bg-black/20", isActive && "bg-black/25")}
                >
                  {t(l.key)}
                </NavLink>
              ))}
            </nav>
          </>
        )}
      </div>
    </header>
  );
}
