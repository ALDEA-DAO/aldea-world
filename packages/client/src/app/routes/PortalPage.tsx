import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import { Skeleton } from "../../components/ui/Skeleton";

const Portal = lazy(() => import("../../features/atlas/Portal").then((m) => ({ default: m.Portal })));

/** `#/portal`: the Portal of Worlds as a full page, with the worlds in a grid. */
export function PortalPage() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8">
      <h1 className="mb-6 text-3xl">{t("screens.portal")}</h1>
      <Suspense fallback={<Skeleton variant="block" className="h-40" />}>
        <Portal layout="page" />
      </Suspense>
    </div>
  );
}
