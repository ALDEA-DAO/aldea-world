import type { CouncilChoice } from "@aldea/shared/council";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";
import { VerifyOnChain } from "../../components/ui/VerifyOnChain";
import { cardanoWallets } from "../founders/LinkCardanoDialog";
import { BatcherError, sendVote, signingAddress, voteToSign, type VoteToSign } from "./councilApi";

/**
 * Signing or objecting to the Charter: the Founder signs their vote with the Cardano wallet linked to their soul (a
 * message, never a transaction) and a batcher publishes it on Base, paying the gas. Three steps: choose the wallet,
 * sign the message (shown exactly as the wallet will sign it), done, with the transaction that carries the vote.
 */

type Wallet = ReturnType<typeof cardanoWallets>[number]["wallet"];
type Api = Awaited<ReturnType<Wallet["enable"]>>;
type Step = { name: "choose" } | { name: "sign"; api: Api; addressHex: string; vote: VoteToSign; busy?: "signing" | "sending" } | { name: "done"; tx?: string };

export interface VoteDialogProps {
  open: boolean;
  onClose: () => void;
  proposalId: string;
  choice: CouncilChoice;
  /** The credential linked to the soul (`stake:<hex28>`): the vote only counts signed by it. */
  credential: string;
  /** Called once the vote is published, with the choice. */
  onVoted: (choice: CouncilChoice) => void;
}

export function VoteDialog({ open, onClose, ...vote }: VoteDialogProps) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onClose={onClose} title={t(vote.choice === "sign" ? "council.voice.sign" : "council.voice.object")} size="md">
      {/* Mounted per opening: closing and reopening starts from the first step */}
      {open && <Steps onClose={onClose} {...vote} />}
    </Dialog>
  );
}

function Steps({ onClose, proposalId, choice, credential, onVoted }: Omit<VoteDialogProps, "open">) {
  const { t } = useTranslation();
  const [wallets, setWallets] = useState<ReturnType<typeof cardanoWallets>>();
  const [step, setStep] = useState<Step>({ name: "choose" });
  const [error, setError] = useState<string>();
  const [connecting, setConnecting] = useState(false);

  // Wallet extensions inject themselves shortly after the page loads
  useEffect(() => {
    const timer = setTimeout(() => setWallets(cardanoWallets()), 0);
    return () => clearTimeout(timer);
  }, []);

  const choose = async (wallet: Wallet) => {
    setError(undefined);
    setConnecting(true);
    try {
      const api = await wallet.enable();
      const addressHex = (await api.getRewardAddresses())[0] ?? (await api.getChangeAddress());
      const signer = signingAddress(addressHex);
      // Another wallet's signature would be published and then not counted: say so before asking for it
      if (signer.credential !== credential) {
        setError("council.vote.errors.otherWallet");
        return;
      }
      setStep({ name: "sign", api, addressHex, vote: voteToSign(proposalId, choice, signer.address) });
    } catch {
      setError("founder.link.errors.walletRefused");
    } finally {
      setConnecting(false);
    }
  };

  const sign = async (current: Extract<Step, { name: "sign" }>) => {
    setError(undefined);
    setStep({ ...current, busy: "signing" });
    let signed: { signature: string; key: string };
    try {
      signed = await current.api.signData(current.addressHex, current.vote.messageHex);
    } catch {
      // Declined in the wallet: back to the message, ready to sign again
      setStep({ ...current, busy: undefined });
      setError("founder.link.errors.signatureRejected");
      return;
    }
    setStep({ ...current, busy: "sending" });
    try {
      const tx = await sendVote(current.vote, signed);
      setStep({ name: "done", tx });
      onVoted(choice);
    } catch (err) {
      const status = err instanceof BatcherError ? err.status : 0;
      setError(status === 401 ? "council.vote.errors.badSignature" : status === 429 ? "council.vote.errors.tooMany" : "council.vote.errors.notPublished");
      // A signature is for one moment: the next try signs a new message
      setStep({ ...current, busy: undefined, vote: voteToSign(proposalId, choice, current.vote.address) });
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {error && <p role="alert">{t(error)}</p>}

      {step.name === "choose" &&
        (wallets === undefined ? null : wallets.length === 0 ? (
          <p role="status">{t("founder.link.noWallets")}</p>
        ) : (
          <>
            <p className="text-sm">{t("council.vote.choose")}</p>
            <ul className="flex flex-col gap-2">
              {wallets.map(({ id, wallet }) => (
                <li key={id}>
                  <Button variant="secondary" className="w-full justify-start gap-3" disabled={connecting} onClick={() => void choose(wallet)}>
                    {wallet.icon && <img src={wallet.icon} alt="" className="size-6" />}
                    <span className="capitalize">{wallet.name}</span>
                  </Button>
                </li>
              ))}
            </ul>
          </>
        ))}

      {step.name === "sign" && (
        <>
          <p className="text-sm">{t(choice === "sign" ? "council.vote.aboutToSign" : "council.vote.aboutToObject")}</p>
          <pre data-testid="vote-message" className="rounded-md border border-border bg-surface-raised p-3 font-mono text-xs break-all whitespace-pre-wrap">
            {step.vote.message}
          </pre>
          <p className="text-sm text-text-muted">{t("council.vote.noTransaction")}</p>
          {step.busy ? (
            <p role="status">{t(step.busy === "signing" ? "founder.link.waiting" : "council.vote.sending")}</p>
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
          <p role="status">{t("council.vote.published")}</p>
          {step.tx && (
            <p className="flex flex-wrap items-center gap-2 text-sm">
              {t("council.verify.yourVote")} <VerifyOnChain txHash={step.tx} />
            </p>
          )}
          <div className="flex justify-end">
            <Button variant="ghost" onClick={onClose}>
              {t("common.close")}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
