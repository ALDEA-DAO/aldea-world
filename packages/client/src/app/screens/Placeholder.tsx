import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

/** Placeholder for screens built in later phases (each route already exists so links never break). */
export function Placeholder({ title, children }: { title: ReactNode; children?: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <h1 className="text-3xl">{title}</h1>
      {children}
      <p className="mt-4 text-muted">{t("common.comingSoon")}</p>
      <Link to="/" className="mt-6 inline-block text-primary underline underline-offset-4">
        {t("common.backHome")}
      </Link>
    </div>
  );
}
