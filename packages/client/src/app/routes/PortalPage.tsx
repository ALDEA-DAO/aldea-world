import { useTranslation } from "react-i18next";
import { Portal } from "../../features/atlas/Portal";

/** `#/portal`: the Portal of Worlds as a full page, with the worlds in a grid. */
export function PortalPage() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8">
      <h1 className="mb-6 text-3xl">{t("screens.portal")}</h1>
      <Portal layout="page" />
    </div>
  );
}
