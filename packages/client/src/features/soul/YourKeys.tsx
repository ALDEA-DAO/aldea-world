import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/ui/Button";
import { useAlmaSession } from "../auth/useAlmaSession";
import { useLinks, type AlmaLink } from "../auth/useLinks";

/**
 * "Tus llaves" (Your keys): every way the soul signs in or acts. Players add a passkey, a recovery email or a wallet
 * (optionally as an owner of their smart wallet), remove keys but never the last way in, and merge a soul whose key
 * they prove. Nudged to keep at least two ways in.
 */
export function YourKeys() {
  const { t } = useTranslation();
  const { signIn } = useAlmaSession();
  const { links, error, linkWallet, startEmail, verifyEmail, addPasskey, remove, merge } = useLinks();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);

  if (!links) return <p className="text-text-muted">{t("keys.loading")}</p>;
  const loginMethods = links.filter((l) => l.roles.includes("login")).length;

  return (
    <section aria-labelledby="your-keys" className="mt-8">
      <h2 id="your-keys" className="text-2xl">
        {t("keys.title")}
      </h2>
      {loginMethods < 2 && <p className="mt-2 rounded-md bg-surface-raised p-3">{t("keys.addAnother")}</p>}

      <ul className="mt-4 flex flex-col gap-2">
        {links.map((link) => (
          <li key={link.id} className="flex items-center gap-3 rounded-md border border-border p-3">
            <div className="flex-1">
              <p className="font-medium">{kindLabel(t, link)}</p>
              {link.kind === "evm" && <p className="font-mono text-xs break-all text-text-muted">{link.display.split(":").at(-1)}</p>}
              <p className="text-xs text-text-muted">{link.roles.map((r) => t(`keys.role.${r}`)).join(" · ")}</p>
            </div>
            {!link.roles.includes("controller") && (
              <Button size="sm" variant="ghost" onClick={() => void remove(link.id)}>
                {t("keys.remove")}
              </Button>
            )}
          </li>
        ))}
      </ul>

      {error && (
        <div role="alert" className="mt-4 flex flex-col gap-2 rounded-md bg-surface-raised p-3">
          <p>{t(`keys.error.${error.code}`, { defaultValue: error.title })}</p>
          {error.code === "step_up_required" && <Button onClick={() => void signIn({ reauthenticate: true })}>{t("keys.confirm")}</Button>}
          {error.code === "link_belongs_to_other_soul" && <Button onClick={() => void merge()}>{t("keys.merge")}</Button>}
        </div>
      )}

      <div className="mt-6 flex flex-wrap gap-2">
        <Button onClick={() => void addPasskey()}>{t("keys.addPasskey")}</Button>
        <Button variant="secondary" onClick={() => void linkWallet(["login"])}>
          {t("keys.linkWallet")}
        </Button>
        <Button variant="ghost" onClick={() => void linkWallet(["login", "controller"])}>
          {t("keys.linkOwner")}
        </Button>
      </div>

      <form
        className="mt-6 flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!codeSent) void startEmail(email).then((ok) => setCodeSent(ok));
          else void verifyEmail(email, code).then((ok) => ok && (setCodeSent(false), setCode(""), setEmail("")));
        }}
      >
        <label className="flex flex-1 flex-col text-sm">
          {t("keys.recoveryEmail")}
          <input className="mt-1 rounded-md border border-border bg-surface px-3 py-2" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        {codeSent && (
          <label className="flex flex-col text-sm">
            {t("keys.code")}
            <input
              className="mt-1 w-32 rounded-md border border-border bg-surface px-3 py-2"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </label>
        )}
        <Button type="submit" variant="secondary">
          {codeSent ? t("keys.verifyEmail") : t("keys.sendCode")}
        </Button>
      </form>
    </section>
  );
}

function kindLabel(t: (key: string) => string, link: AlmaLink) {
  if (link.roles.includes("controller") && link.label === "Coinbase Smart Wallet") return t("keys.kind.smartWallet");
  return t(`keys.kind.${link.kind}`);
}
