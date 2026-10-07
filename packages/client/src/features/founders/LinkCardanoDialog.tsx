import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";
import { MonoId } from "../../components/ui/MonoId";
import { AlmaApiError, createAlmaApi } from "../../lib/almaApi";
import { problemCopy } from "../../lib/problems";
import { authConfig } from "../auth/config";
import { useAlmaSession } from "../auth/useAlmaSession";
import { formatAldea } from "./useFounder";
import { track } from "../../lib/analytics";

/**
 * "Vincular Cardano": links a Cardano wallet to the soul with a signature (CIP-30 `signData`), so its $ALDEA counts.
 * Three steps: choose the wallet, sign the message (shown exactly as the wallet will sign it), done. It never builds a
 * transaction: nothing moves and there is no fee.
 *
 * The message is signed with the wallet's stake address: the Resolver links a stake credential only when its own key
 * signed, since a payment key proves nothing about the stake part of an address.
 */

/** The part of CIP-30 this dialog uses. */
interface Cip30Api {
  getRewardAddresses(): Promise<string[]>;
  getChangeAddress(): Promise<string>;
  signData(address: string, payloadHex: string): Promise<{ signature: string; key: string }>;
}
interface Cip30Wallet {
  name: string;
  icon?: string;
  enable(): Promise<Cip30Api>;
}

/** The CIP-30 wallets installed in this browser. */
export function cardanoWallets(): { id: string; wallet: Cip30Wallet }[] {
  const injected = (window as { cardano?: Record<string, unknown> }).cardano ?? {};
  return Object.entries(injected)
    .filter(([, value]) => typeof value === "object" && value !== null && typeof (value as Cip30Wallet).enable === "function" && typeof (value as Cip30Wallet).name === "string")
    .map(([id, value]) => ({ id, wallet: value as Cip30Wallet }));
}

interface Challenge {
  challengeId: string;
  payload: string;
  payloadHex: string;
}

export interface CardanoLinked {
  link: { value: string; hasStakePart: boolean };
  /** null when Cardano could not be read: the wallet is linked anyway. */
  holdings: { balance: string; eligible: boolean; minimum: string } | null;
}

const ERROR_COPY: Record<string, string> = {
  credential_linked_elsewhere: "founder.link.errors.linkedElsewhere",
  cardano_already_linked: "founder.link.errors.alreadyLinked",
  invalid_cip8_signature: "founder.link.errors.badSignature",
  challenge_expired: "founder.link.errors.expired",
  wrong_network: "founder.link.errors.wrongNetwork",
  unsupported_address: "founder.link.errors.unsupported",
};

type Step = { name: "choose" } | { name: "sign"; api: Cip30Api; address: string; challenge: Challenge; waiting: boolean } | { name: "done"; linked: CardanoLinked };

export function LinkCardanoDialog({ open, onClose, onLinked, onClaim }: { open: boolean; onClose: () => void; onLinked?: (linked: CardanoLinked) => void; onClaim?: () => void }) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onClose={onClose} title={t("founder.link.title")} size="md">
      {/* Mounted per opening: closing and reopening starts from the first step */}
      {open && <Steps onClose={onClose} onLinked={onLinked} onClaim={onClaim} />}
    </Dialog>
  );
}

function Steps({ onClose, onLinked, onClaim }: { onClose: () => void; onLinked?: (linked: CardanoLinked) => void; onClaim?: () => void }) {
  const { t, i18n } = useTranslation();
  const { accessToken } = useAlmaSession();
  const almaApi = useMemo(() => createAlmaApi({ apiUrl: authConfig().apiUrl, accessToken }), [accessToken]);
  const [wallets, setWallets] = useState<ReturnType<typeof cardanoWallets>>();
  const [step, setStep] = useState<Step>({ name: "choose" });
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  // Wallet extensions inject themselves shortly after the page loads
  useEffect(() => {
    const read = () => setWallets(cardanoWallets());
    const timer = setTimeout(read, 0);
    return () => clearTimeout(timer);
  }, []);

  const choose = async (wallet: Cip30Wallet) => {
    setError(undefined);
    setBusy(true);
    try {
      const api = await wallet.enable();
      // The stake address when the wallet has one; a wallet without staking is linked by its payment address
      const address = (await api.getRewardAddresses())[0] ?? (await api.getChangeAddress());
      const challenge = await almaApi<Challenge>("/v1/cardano/link/challenge", { body: {} });
      setStep({ name: "sign", api, address, challenge, waiting: false });
    } catch (err) {
      setError(err instanceof AlmaApiError ? problemCopy(err.code, ERROR_COPY) : "founder.link.errors.walletRefused");
    } finally {
      setBusy(false);
    }
  };

  const sign = async (current: Extract<Step, { name: "sign" }>) => {
    setError(undefined);
    setStep({ ...current, waiting: true });
    let signed: { signature: string; key: string };
    try {
      signed = await current.api.signData(current.address, current.challenge.payloadHex);
    } catch {
      // Declined in the wallet: back to the message, ready to sign again
      setStep({ ...current, waiting: false });
      setError("founder.link.errors.signatureRejected");
      return;
    }
    try {
      const linked = await almaApi<CardanoLinked>("/v1/cardano/link/verify", { body: { challengeId: current.challenge.challengeId, address: current.address, ...signed } });
      setStep({ name: "done", linked });
      track("cardano_link_completed", { eligible: Boolean(linked.holdings?.eligible) });
      onLinked?.(linked);
    } catch (err) {
      const code = err instanceof AlmaApiError ? err.code : "";
      setError(err instanceof AlmaApiError ? problemCopy(code, ERROR_COPY) : "founder.link.errors.generic");
      // A used or expired challenge cannot be signed again: start over with a new one
      if (code === "challenge_expired" || code === "invalid_cip8_signature") setStep({ name: "choose" });
      else setStep({ ...current, waiting: false });
    }
  };

  const steps = ["choose", "sign", "done"] as const;
  return (
    <div className="flex flex-col gap-4">
      <ol className="flex gap-2 text-xs text-text-muted" aria-label={t("founder.link.steps")}>
        {steps.map((name, i) => (
          <li key={name} aria-current={step.name === name ? "step" : undefined} className={step.name === name ? "font-bold text-text" : undefined}>
            {i + 1}. {t(`founder.link.step.${name}`)}
          </li>
        ))}
      </ol>

      {error && <p role="alert">{t(error)}</p>}

      {step.name === "choose" &&
        (wallets === undefined ? null : wallets.length === 0 ? (
          <p role="status">{t("founder.link.noWallets")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {wallets.map(({ id, wallet }) => (
              <li key={id}>
                <Button variant="secondary" className="w-full justify-start gap-3" disabled={busy} onClick={() => void choose(wallet)}>
                  {wallet.icon && <img src={wallet.icon} alt="" className="size-6" />}
                  <span className="capitalize">{wallet.name}</span>
                </Button>
              </li>
            ))}
          </ul>
        ))}

      {step.name === "sign" && (
        <>
          <p className="text-sm">{t("founder.link.signIntro")}</p>
          <pre data-testid="cardano-payload" className="rounded-md border border-border bg-surface-raised p-3 font-mono text-xs break-all whitespace-pre-wrap">
            {step.challenge.payload}
          </pre>
          <p className="text-sm text-text-muted">{t("founder.link.noTransaction")}</p>
          {step.waiting ? (
            <p role="status">{t("founder.link.waiting")}</p>
          ) : (
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={onClose}>
                {t("founder.link.cancel")}
              </Button>
              <Button onClick={() => void sign(step)}>{t("founder.link.sign")}</Button>
            </div>
          )}
        </>
      )}

      {step.name === "done" && (
        <>
          <p role="status">{t("founder.link.linked")}</p>
          <MonoId value={step.linked.link.value} short />
          {!step.linked.link.hasStakePart && <p className="text-sm text-text-muted">{t("founder.link.noStakePart")}</p>}
          {step.linked.holdings === null ? (
            <p className="text-sm">{t("founder.errors.readingCardano")}</p>
          ) : (
            <p data-testid="cardano-holdings">
              {t("founder.link.holdings", { amount: formatAldea(step.linked.holdings.balance, i18n.language) })}
              {!step.linked.holdings.eligible && (
                <>
                  {" "}
                  {t("founder.errors.missing", { amount: formatAldea(BigInt(step.linked.holdings.minimum) - BigInt(step.linked.holdings.balance), i18n.language) })}
                </>
              )}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              {t("common.close")}
            </Button>
            {step.linked.holdings?.eligible && onClaim && (
              <Button
                onClick={() => {
                  onClaim();
                  onClose();
                }}
              >
                {t("founder.claim")}
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
