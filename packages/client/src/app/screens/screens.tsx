import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Placeholder } from "./Placeholder";

export function WorldScreen() {
  const { t } = useTranslation();
  const { worldId } = useParams();
  return (
    <Placeholder title={t("screens.world")}>
      <p className="mt-2 font-mono text-xs break-all">{worldId}</p>
    </Placeholder>
  );
}

export function SimpleScreen({ titleKey }: { titleKey: string }) {
  const { t } = useTranslation();
  return <Placeholder title={t(titleKey)} />;
}

export function NotFoundScreen() {
  const { t } = useTranslation();
  return <Placeholder title={t("screens.notFound")} />;
}
