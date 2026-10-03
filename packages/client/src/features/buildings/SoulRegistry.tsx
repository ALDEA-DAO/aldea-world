import { classByIndex, tribeByIndex } from "@aldea/shared/catalog";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Button } from "../../components/ui/Button";
import { MonoId } from "../../components/ui/MonoId";
import { Panel } from "../../components/ui/Panel";
import { Skeleton } from "../../components/ui/Skeleton";
import { TribeChip } from "../../components/ui/TribeChip";
import { VerifyOnChain } from "../../components/ui/VerifyOnChain";
import { isSignedIn } from "../auth/AlmaAuthProvider";
import { RequireSession } from "../auth/RequireSession";
import { useAlmaSession } from "../auth/useAlmaSession";
import { useBirth } from "../birth/useBirth";
import { TribeMembers } from "../soul/TribeMembers";
import { founderClaimed, useSoul, type SoulView } from "../soul/useSoul";
import { YourKeys } from "../soul/YourKeys";

/** The standalone page of a soul (`#/alma/:almaId`); in the village the registry's content opens in its panel. */
export function SoulRegistry({ almaId }: { almaId?: string }) {
  const { t } = useTranslation();
  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <Panel variant="inline" title={t("registry.title")}>
        <SoulRegistryContent almaId={almaId} />
      </Panel>
    </div>
  );
}

/**
 * The Soul Registry: a soul's identity and its evidence, in four sections: the soul (identifier, type, date and
 * status), its ties (character, tribe and the tribe's members), its keys (only on your own soul) and its seals.
 * `almaId` undefined shows the signed-in soul. When the Resolver is down, what the World knows (your character and
 * tribe) is still shown.
 */
export function SoulRegistryContent({ almaId }: { almaId?: string }) {
  const { t } = useTranslation();
  const session = useAlmaSession();
  const { stage } = useBirth();
  const { soul, tribe, loading, failed, own } = useSoul(almaId, stage === "born");
  const guestOnOwn = almaId === undefined && !isSignedIn(session.status);

  if (guestOnOwn) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p>{t("registry.notBornYet")}</p>
        <RequireSession action={t("registry.seeYourSoul")}>
          <span />
        </RequireSession>
      </div>
    );
  }
  if (failed) {
    return (
      <div className="flex flex-col gap-4">
        <p role="alert">{t("registry.closed")}</p>
        {own && <WorldCharacter />}
      </div>
    );
  }
  if (loading || !soul) return <Skeleton className="h-40" />;

  return (
    <div className="flex flex-col gap-8" data-testid="soul-registry">
      <section aria-labelledby="your-soul">
        <h2 id="your-soul" className="text-2xl">
          {own ? t("registry.yourSoul") : t("registry.aSoul")}
        </h2>
        <div className="mt-2">
          <MonoId value={soul.id} />
        </div>
        <SoulFacts soul={soul} />
      </section>

      <Ties soul={soul} tribe={tribe} own={own} born={stage === "born"} />

      {own && <YourKeys />}

      <Seals soul={soul} own={own} />

      <section aria-labelledby="agents-soon" className="rounded-md border border-dashed border-border p-4">
        <h2 id="agents-soon" className="text-lg">
          {t("registry.agentsSoon")}
        </h2>
        <p className="mt-1 text-sm text-text-muted">{t("registry.agentsSoonText")}</p>
      </section>
    </div>
  );
}

function SoulFacts({ soul }: { soul: SoulView }) {
  const { t, i18n } = useTranslation();
  return (
    <p className="mt-1 text-sm text-text-muted">
      {t(`registry.type.${soul.type}`)} · {new Date(soul.createdAt).toLocaleDateString(i18n.language)} · {t(`registry.status.${soul.status}`)}
    </p>
  );
}

/** Character and tribe, each with its evidence, and the tribe's members on demand. */
function Ties({ soul, tribe, own, born }: { soul: SoulView; tribe: ReturnType<typeof useSoul>["tribe"]; own: boolean; born: boolean }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "en" ? "en" : "es";
  const [showMembers, setShowMembers] = useState(false);
  const character = soul.character;
  return (
    <section aria-labelledby="your-ties">
      <h2 id="your-ties" className="text-2xl">
        {own ? t("registry.yourTies") : t("registry.ties")}
      </h2>
      {character && (
        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>
            {classByIndex(character.characterClass)?.name[lang]}
            {character.bornAt && ` · ${t("registry.bornOn", { date: new Date(character.bornAt).toLocaleDateString(i18n.language) })}`}
          </span>
          {/* The birth's transaction is the tribe membership's evidence too: shown once, next to the tribe */}
          {character.bornTx && character.bornTx !== tribe?.txHash && <VerifyOnChain txHash={character.bornTx} />}
        </p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-3">
        {tribe ? (
          <>
            <TribeChip tribe={tribe.index} />
            {tribe.txHash && <VerifyOnChain txHash={tribe.txHash} />}
            <Button variant="ghost" size="sm" aria-expanded={showMembers} onClick={() => setShowMembers((v) => !v)}>
              {own ? t("tribe.mine") : t("tribe.members")}
            </Button>
          </>
        ) : own && born ? (
          <p role="status">{t("registry.registeringTribe")}</p>
        ) : (
          <p>
            {own ? t("registry.notBornYet") : t("registry.noTies")}{" "}
            {own && (
              <Link className="underline" to="/b/centro-urbano">
                {t("nav.townCenter")}
              </Link>
            )}
          </p>
        )}
      </div>
      {tribe && showMembers && (
        <div className="mt-3">
          <TribeMembers tribeAlmaId={tribe.almaOrgId} highlight={soul.id} />
        </div>
      )}
    </section>
  );
}

/** Founder and Charter Signatory. Claiming the Founder seal arrives with FR-038; signing, with the Council. */
function Seals({ soul, own }: { soul: SoulView; own: boolean }) {
  const { t } = useTranslation();
  const founder = founderClaimed(soul);
  return (
    <section aria-labelledby="seals">
      <h2 id="seals" className="text-2xl">
        {t("registry.seals")}
      </h2>
      <ul className="mt-2 flex flex-col gap-2 text-sm">
        <li>
          <span className="font-medium">{t("registry.founder")}</span>
          {" · "}
          {founder ? t("registry.sealHeld") : own ? t("registry.founderNotYet") : t("registry.sealNone")}
        </li>
        <li>
          <span className="font-medium">{t("registry.charterSignatory")}</span>
          {" · "}
          {own ? t("registry.charterNotYet") : t("registry.sealNone")}
        </li>
      </ul>
    </section>
  );
}

/** With the Registry closed, your character and tribe as the World (MUD) knows them. */
function WorldCharacter() {
  const { i18n } = useTranslation();
  const lang = i18n.language === "en" ? "en" : "es";
  const { character, stage } = useBirth();
  if (stage !== "born" || !character) return null;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span>{classByIndex(character.characterClass)?.name[lang]}</span>
      {tribeByIndex(character.tribe) && <TribeChip tribe={character.tribe} />}
    </div>
  );
}
