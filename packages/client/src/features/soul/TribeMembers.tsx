import { classByIndex, tribes } from "@aldea/shared/catalog";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Button } from "../../components/ui/Button";
import { Skeleton } from "../../components/ui/Skeleton";
import { VerifyOnChain } from "../../components/ui/VerifyOnChain";
import { createAlmaApi } from "../../lib/almaApi";
import { authConfig } from "../auth/config";

interface Member {
  almaId: string;
  characterClass: number | null;
  joinedAt: string;
  evidence: { txHash?: string };
}

interface Page {
  items: Member[];
  nextCursor: string | null;
}

const PAGE_SIZE = 50;
const shortId = (almaId: string) => `${almaId.slice(16, 22)}…${almaId.slice(-4)}`;

/**
 * "Mi tribu": the souls that are members of a tribe's organization, 50 at a time (cursor pagination), each with its
 * class, the day it joined and the on-chain evidence. Only public facts: memberships are on-chain.
 */
export function TribeMembers({ tribeAlmaId, highlight }: { tribeAlmaId: string; highlight?: string }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "en" ? "en" : "es";
  const almaApi = useMemo(() => createAlmaApi({ apiUrl: authConfig().apiUrl, accessToken: () => undefined }), []);
  const [members, setMembers] = useState<Member[]>();
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const tribe = tribes.find((x) => x.almaOrgId === tribeAlmaId);

  const load = useCallback(
    (after: string | null) =>
      almaApi<Page>(`/v1/orgs/${encodeURIComponent(tribeAlmaId)}/members?limit=${PAGE_SIZE}${after ? `&cursor=${encodeURIComponent(after)}` : ""}`),
    [almaApi, tribeAlmaId],
  );

  useEffect(() => {
    let current = true;
    load(null)
      .then((page) => current && (setMembers(page.items), setCursor(page.nextCursor), setFailed(false)))
      .catch(() => current && setFailed(true))
      .finally(() => current && setLoading(false));
    return () => {
      current = false;
    };
  }, [load]);

  const more = () => {
    setLoading(true);
    load(cursor)
      .then((page) => (setMembers((all) => [...(all ?? []), ...page.items]), setCursor(page.nextCursor)))
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  };

  if (failed && !members) return <p role="alert">{t("registry.closed")}</p>;
  if (!members) return <Skeleton className="h-24" />;
  if (members.length === 0) return <p className="text-text-muted">{t("tribe.empty")}</p>;

  return (
    <div className="flex flex-col gap-3" data-testid="tribe-members">
      <ul aria-label={t("tribe.membersOf", { tribe: tribe?.name[lang] ?? "" })} className="flex flex-col divide-y divide-border">
        {members.map((m) => (
          <li key={m.almaId} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
            <Link to={`/alma/${encodeURIComponent(m.almaId)}`} title={m.almaId} className="font-mono underline underline-offset-4">
              {shortId(m.almaId)}
            </Link>
            {m.almaId === highlight && <span className="rounded-sm bg-surface-raised px-1.5 text-xs">{t("tribe.you")}</span>}
            <span>{m.characterClass === null ? "" : classByIndex(m.characterClass)?.name[lang]}</span>
            <span className="text-text-muted">{new Date(m.joinedAt).toLocaleDateString(i18n.language)}</span>
            {m.evidence.txHash && <VerifyOnChain txHash={m.evidence.txHash} />}
          </li>
        ))}
      </ul>
      {failed && <p role="alert">{t("errors.network")}</p>}
      {cursor && (
        <Button variant="ghost" size="sm" onClick={more} disabled={loading} className="self-start">
          {t("tribe.more")}
        </Button>
      )}
    </div>
  );
}
