import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

/** A route that does not exist: say so, and show the way back. */
export function NotFoundScreen() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-12">
      <h1 className="text-3xl">{t("screens.notFound")}</h1>
      <Link to="/" className="mt-6 inline-block text-primary underline underline-offset-4">
        {t("common.backHome")}
      </Link>
    </div>
  );
}
