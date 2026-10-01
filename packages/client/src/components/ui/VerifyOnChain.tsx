import { ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";
import { authConfig } from "../../features/auth/config";

const abbreviate = (hash: string) => (hash.length > 12 ? `${hash.slice(0, 6)}…${hash.slice(-4)}` : hash);

/**
 * The evidence behind a fact: a link to the transaction on the chain's explorer (Basescan), opened in a new tab.
 * On a chain without an explorer (local anvil) the abbreviated hash is shown without a link.
 */
export function VerifyOnChain({ txHash, block = false }: { txHash: string; block?: boolean }) {
  const { t } = useTranslation();
  const explorer = authConfig().chain.blockExplorers?.default.url;
  const label = t("identity.viewOnChain", { hash: abbreviate(txHash) });
  const className = `${block ? "flex" : "inline-flex"} items-center gap-1 font-mono text-xs`;
  if (!explorer) {
    return (
      <span className={className} title={txHash}>
        {abbreviate(txHash)}
      </span>
    );
  }
  return (
    <a className={`${className} underline`} href={`${explorer}/tx/${txHash}`} target="_blank" rel="noreferrer" aria-label={label} title={txHash}>
      {abbreviate(txHash)}
      <ExternalLink aria-hidden className="size-3.5" />
    </a>
  );
}
