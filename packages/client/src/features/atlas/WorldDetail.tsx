import { ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";
import { Button } from "../../components/ui/Button";
import { MonoId } from "../../components/ui/MonoId";
import { Skeleton } from "../../components/ui/Skeleton";
import { StatusPill, type StatusTone } from "../../components/ui/StatusPill";
import { VerifyOnChain } from "../../components/ui/VerifyOnChain";
import { fetchWorld, type AtlasWorldDetail, type VersionStatus } from "./atlasApi";
import { VerifiedBadge } from "./WorldCard";

const STATUS_TONE: Record<VersionStatus, StatusTone> = { official: "success", candidate: "warning", superseded: "neutral", withdrawn: "muted", none: "neutral" };

/**
 * `#/portal/:worldId`: everything the Atlas holds about a world, to audit it: its versions (each with the CID of its
 * client, the commit it was built from and the World contract it runs on), where it comes from and who serves it.
 * Every row links to the transaction that registered it.
 */
export function WorldDetail() {
  const { t, i18n } = useTranslation();
  const { worldId = "" } = useParams();
  const [round, setRound] = useState(0);
  // The answer for one request: `world` null means the Atlas does not know this world
  const request = `${worldId.toLowerCase()}:${round}`;
  const [answer, setAnswer] = useState<{ request: string; world?: AtlasWorldDetail | null }>();
  const loaded = answer?.request === request ? answer : undefined;
  const world = loaded && "world" in loaded ? loaded.world : undefined;
  const failed = loaded !== undefined && !("world" in loaded);

  useEffect(() => {
    let current = true;
    fetchWorld(worldId.toLowerCase())
      .then((w) => current && setAnswer({ request, world: w }))
      .catch(() => current && setAnswer({ request }));
    return () => {
      current = false;
    };
  }, [worldId, request]);

  const back = (
    <Link to="/portal" className="text-sm underline underline-offset-4">
      {t("world.backToPortal")}
    </Link>
  );

  if (failed) {
    return (
      <Frame>
        <p className="flex flex-wrap items-center gap-2" role="status">
          {t("portal.clouded")}
          <Button variant="ghost" size="sm" className="relative" onClick={() => setRound((n) => n + 1)}>
            {t("portal.retry")}
          </Button>
        </p>
        {back}
      </Frame>
    );
  }
  if (world === null) {
    return (
      <Frame>
        <h1 className="text-3xl">{t("screens.world")}</h1>
        <p role="status">{t("world.notFound")}</p>
        {back}
      </Frame>
    );
  }
  if (!world) {
    return (
      <Frame>
        <Skeleton className="h-9 w-64" />
        <Skeleton variant="block" className="h-48" />
      </Frame>
    );
  }

  const date = (ts: number | null) => (ts === null ? "" : new Date(ts * 1000).toLocaleDateString(i18n.language, { year: "numeric", month: "short", day: "numeric" }));

  return (
    <Frame>
      <nav aria-label={t("world.lineage")}>
        <ol className="flex flex-wrap items-center gap-1 text-sm">
          <li>{back}</li>
          {world.lineage.map((ancestor, i) => (
            <li key={ancestor.worldId} className="flex items-center gap-1">
              <ChevronRight aria-hidden className="size-4 text-text-muted" />
              {i === world.lineage.length - 1 ? (
                <span aria-current="page">{ancestor.name}</span>
              ) : (
                <Link to={`/portal/${ancestor.worldId}`} className="underline underline-offset-4">
                  {ancestor.name}
                </Link>
              )}
            </li>
          ))}
        </ol>
      </nav>

      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl">{world.name}</h1>
          {world.verified ? <VerifiedBadge /> : <StatusPill tone="warning">{t("world.unverified")}</StatusPill>}
        </div>
        <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
          <dt className="text-text-muted">{t("world.organization")}</dt>
          <dd>
            <MonoId value={world.org.almaId ?? world.org.almaIdHash} />
          </dd>
          <dt className="text-text-muted">{t("world.id")}</dt>
          <dd>
            <MonoId value={world.worldId} short />
          </dd>
          <dt className="text-text-muted">{t("world.governor")}</dt>
          <dd>
            <MonoId value={world.governor} />
          </dd>
          {world.createdTx && (
            <>
              <dt className="text-text-muted">{t("world.registered")}</dt>
              <dd>
                <VerifyOnChain txHash={world.createdTx} />
              </dd>
            </>
          )}
        </dl>
      </header>

      <section aria-labelledby="world-versions" className="flex flex-col gap-2">
        <h2 id="world-versions" className="font-display text-2xl">
          {t("world.versions")}
        </h2>
        {world.versions.length === 0 ? (
          <p>{t("world.noVersions")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-border-strong">
                  {(["status", "semver", "cid", "commit", "chain", "contract", "date", "evidence"] as const).map((column) => (
                    <th key={column} scope="col" className="px-2 py-2 font-bold">
                      {t(`world.columns.${column}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {world.versions.map((version) => (
                  <tr key={version.versionId} className="border-b border-border align-top">
                    <td className="px-2 py-2">
                      <StatusPill tone={STATUS_TONE[version.status]}>{t(`world.status.${version.status}`)}</StatusPill>
                    </td>
                    <th scope="row" className="px-2 py-2 font-medium">
                      {version.semver}
                    </th>
                    <td className="px-2 py-2">
                      <MonoId value={version.clientCid} short />
                    </td>
                    <td className="px-2 py-2 font-mono text-xs" title={version.gitCommit}>
                      {version.gitCommit.replace(/^0x/, "").slice(0, 7)}
                    </td>
                    <td className="px-2 py-2">{version.chainId}</td>
                    <td className="px-2 py-2">
                      <MonoId value={version.worldAddress} short />
                    </td>
                    <td className="px-2 py-2 whitespace-nowrap">{date(version.registeredTs)}</td>
                    <td className="px-2 py-2">{version.registeredTx && <VerifyOnChain txHash={version.registeredTx} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="world-clients" className="flex flex-col gap-2">
        <h2 id="world-clients" className="font-display text-2xl">
          {t("world.clients")}
        </h2>
        {world.clients.length === 0 ? (
          <p>{t("world.noClients")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {world.clients.map((client) => (
              <li key={client.clientId} className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border border-border bg-surface-raised px-3 py-2 text-sm">
                <span className="font-mono text-xs break-all">{client.url}</span>
                <StatusPill>{t(`world.clientKind.${client.kind}`)}</StatusPill>
                <span className="text-text-muted">{t("world.operatedBy", { operator: client.operatorAlmaId ?? client.operatorAlmaIdHash })}</span>
                {client.registeredTx && <VerifyOnChain txHash={client.registeredTx} />}
              </li>
            ))}
          </ul>
        )}
      </section>
    </Frame>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8">{children}</div>;
}
