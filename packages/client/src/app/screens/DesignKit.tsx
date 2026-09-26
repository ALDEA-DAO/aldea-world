import { tribes } from "@aldea/shared/catalog";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";
import { Panel } from "../../components/ui/Panel";
import { Skeleton } from "../../components/ui/Skeleton";
import { Tabs } from "../../components/ui/Tabs";
import { useToast } from "../../components/ui/Toast";

/** Test page for the base components (TASK-013 verification): #/ui */
export function DesignKitScreen() {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [tab, setTab] = useState("census");
  const lang = i18n.language === "en" ? "en" : "es";

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-10 px-4 py-10">
      <header>
        <h1 className="text-4xl">{t("kit.title")}</h1>
        <p className="mt-2 text-lg text-muted">{t("kit.intro")}</p>
      </header>

      <section aria-labelledby="kit-buttons" className="flex flex-col gap-4">
        <h2 id="kit-buttons" className="text-2xl">
          {t("kit.buttons")}
        </h2>
        <div className="flex flex-wrap items-center gap-3">
          <Button size="lg">{t("kit.primary")}</Button>
          <Button variant="secondary">{t("kit.secondary")}</Button>
          <Button variant="ghost">{t("kit.ghost")}</Button>
          <Button variant="danger" size="sm">
            {t("kit.danger")}
          </Button>
          <Button disabled>{t("kit.disabled")}</Button>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button variant="secondary" onClick={() => setDialogOpen(true)}>
            {t("kit.openDialog")}
          </Button>
          <Button variant="ghost" onClick={() => toast.show(t("kit.toastMessage"), "success")}>
            {t("kit.showToast")}
          </Button>
          <Button variant="ghost" onClick={() => toast.show(t("kit.toastError"), "error")}>
            {t("kit.showError")}
          </Button>
        </div>
      </section>

      <Panel variant="inline" title={t("kit.panelTitle")}>
        <p className="text-lg">{t("kit.panelBody")}</p>
        <div className="mt-6">
          <Button size="lg" className="w-full">
            {t("kit.primary")}
          </Button>
        </div>
      </Panel>

      <section aria-labelledby="kit-tabs" className="flex flex-col gap-4">
        <h2 id="kit-tabs" className="text-2xl">
          {t("kit.tabs")}
        </h2>
        <Tabs
          label={t("kit.tabs")}
          value={tab}
          onChange={setTab}
          items={[
            { id: "census", label: t("kit.tabCensus"), content: <p>{t("kit.tabCensusBody")}</p> },
            { id: "birth", label: t("kit.tabBirth"), content: <p>{t("kit.tabBirthBody")}</p> },
          ]}
        />
      </section>

      <section aria-labelledby="kit-tribes" className="flex flex-col gap-4">
        <h2 id="kit-tribes" className="text-2xl">
          {t("kit.tribes")}
        </h2>
        <ul className="flex flex-wrap gap-2">
          {tribes.map((tribe) => (
            <li
              key={tribe.enum}
              className="inline-flex h-8 items-center rounded-full px-3 text-sm font-bold text-on-tribe"
              style={{ background: `var(${tribe.colorToken})` }}
            >
              {tribe.name[lang]}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="kit-skeletons" className="flex flex-col gap-3">
        <h2 id="kit-skeletons" className="text-2xl">
          {t("kit.skeletons")}
        </h2>
        <Skeleton />
        <Skeleton variant="block" />
        <Skeleton variant="card" />
      </section>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} title={t("kit.dialogTitle")}>
        <p>{t("kit.dialogBody")}</p>
      </Dialog>
    </div>
  );
}
