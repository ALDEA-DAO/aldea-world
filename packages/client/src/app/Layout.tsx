import { NavLink, Outlet } from "react-router-dom";
import { useTranslation } from "react-i18next";
import clsx from "clsx";

const links = [
  { to: "/", key: "nav.village", end: true },
  { to: "/lista", key: "nav.list" },
  { to: "/portal", key: "nav.portal" },
  { to: "/ajustes", key: "nav.settings" },
  { to: "/ui", key: "nav.designKit" },
] as const;

/** Temporary shell until the in-world HUD: top bar with the main routes. */
export function Layout() {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex h-hud-top items-center gap-4 bg-wood px-4 text-on-wood shadow-paper">
        <span className="font-display text-xl">{t("app.name")}</span>
        <nav aria-label={t("app.name")} className="flex flex-1 gap-1 overflow-x-auto">
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={"end" in l ? l.end : false}
              className={({ isActive }) =>
                clsx("inline-flex min-h-11 items-center rounded-md px-3 text-sm whitespace-nowrap hover:bg-black/20", isActive && "bg-black/25")
              }
            >
              {t(l.key)}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  );
}
