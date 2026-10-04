import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Tabs } from "../../components/ui/Tabs";

export const PORTAL_FILTERS = ["verified", "all", "forks"] as const;
export type PortalFilter = (typeof PORTAL_FILTERS)[number];

/** The Portal's filters as tabs: verified worlds (the default, so unknown worlds are opt-in), all of them, ALDEA's forks. */
export function FilterTabs({ value, onChange, children }: { value: PortalFilter; onChange: (filter: PortalFilter) => void; children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <Tabs
      label={t("portal.filters.label")}
      value={value}
      onChange={(id) => onChange(id as PortalFilter)}
      // One list for whichever filter is active
      items={PORTAL_FILTERS.map((filter) => ({ id: filter, label: t(`portal.filters.${filter}`), content: filter === value ? children : null }))}
    />
  );
}
