import { html, raw } from "hono/html";

/**
 * The hosted "Sign in with ALMA" page. Passkey first, then an email code and a wallet. No bundle: passkeys use the
 * browser's WebAuthn JSON API (`parseRequestOptionsFromJSON`, `toJSON`) and wallets EIP-1193 (`window.ethereum`).
 */

export type Locale = "es" | "en";

const COPY = {
  es: {
    title: "Entra con tu alma",
    lead: (client: string) => `${client} te pide entrar con ALMA. Tu alma es tuya: la misma en cada mundo.`,
    passkey: "Entrar con mi passkey",
    create: "Crear mi alma con una passkey",
    or: "o",
    email: "Recibir un código por email",
    emailPlaceholder: "tu@email.com",
    send: "Enviar código",
    codeSent: "Si el email es válido, te llegó un código de 6 dígitos.",
    codePlaceholder: "123456",
    verify: "Entrar",
    wallet: "Tengo una wallet",
    noWallet: "No encontramos una wallet en este navegador.",
    noPasskey: "No encontramos una passkey para ALMA en este dispositivo. Puedes crear tu alma con una nueva.",
    unsupported: "Este navegador no soporta passkeys. Usa el código por email.",
    cancel: "Cancelar",
    failed: "No salió. Prueba de nuevo.",
  },
  en: {
    title: "Sign in with your soul",
    lead: (client: string) => `${client} asks you to sign in with ALMA. Your soul is yours: the same in every world.`,
    passkey: "Sign in with my passkey",
    create: "Create my soul with a passkey",
    or: "or",
    email: "Get a code by email",
    emailPlaceholder: "you@email.com",
    send: "Send code",
    codeSent: "If the email is valid, a 6-digit code is on its way.",
    codePlaceholder: "123456",
    verify: "Sign in",
    wallet: "I have a wallet",
    noWallet: "We could not find a wallet in this browser.",
    noPasskey: "We could not find an ALMA passkey on this device. You can create your soul with a new one.",
    unsupported: "This browser does not support passkeys. Use the email code.",
    cancel: "Cancel",
    failed: "That did not work. Try again.",
  },
} as const;

export function renderLoginPage({ uid, clientName, locale, nonce }: { uid: string; clientName: string; locale: Locale; nonce: string }) {
  const t = COPY[locale];
  const messages = JSON.stringify({ noWallet: t.noWallet, noPasskey: t.noPasskey, unsupported: t.unsupported, codeSent: t.codeSent, failed: t.failed });
  return html`<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>ALMA · ${t.title}</title>
<style nonce="${nonce}">
:root{--bg:#f6f1e7;--fg:#2a2118;--muted:#6b5d4f;--accent:#8a4b2a;--card:#fffaf1;--line:#e3d6c2}
@media (prefers-color-scheme:dark){:root{--bg:#17120d;--fg:#f2e8d8;--muted:#b7a58f;--accent:#e0a077;--card:#211a13;--line:#3a2f24}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,sans-serif;padding:16px}
main{width:100%;max-width:380px;background:var(--card);border:1px solid var(--line);border-radius:16px;padding:28px}
h1{font-size:1.5rem;margin:0 0 .25rem}p{color:var(--muted);margin:0 0 1.25rem}
button,input{width:100%;font:inherit;border-radius:10px;padding:.75rem 1rem;margin:.25rem 0}
button{border:1px solid var(--line);background:transparent;color:var(--fg);cursor:pointer}
button.primary{background:var(--accent);border-color:var(--accent);color:#fff;font-weight:600}
input{border:1px solid var(--line);background:var(--bg);color:var(--fg)}
.or{text-align:center;color:var(--muted);margin:.75rem 0;font-size:.9rem}.msg{min-height:1.5em;color:var(--accent);font-size:.9rem}
.link{border:none;color:var(--muted);text-decoration:underline;padding:.25rem}[hidden]{display:none}
</style>
</head>
<body>
<main>
  <h1>${t.title}</h1>
  <p>${t.lead(clientName)}</p>
  <button class="primary" id="passkey">${t.passkey}</button>
  <button id="create" hidden>${t.create}</button>
  <div class="or">${t.or}</div>
  <form id="email-form"><input id="email" type="email" autocomplete="email" placeholder="${t.emailPlaceholder}" required><button type="submit">${t.email}</button></form>
  <form id="code-form" hidden><input id="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" placeholder="${t.codePlaceholder}" required><button class="primary" type="submit">${t.verify}</button></form>
  <button id="wallet">${t.wallet}</button>
  <div class="msg" id="msg" role="status" aria-live="polite"></div>
  <button class="link" id="cancel">${t.cancel}</button>
</main>
<script nonce="${nonce}">
${raw(`(() => {
  const base = "/interaction/${uid}";
  const m = ${messages};
  const $ = (id) => document.getElementById(id);
  const say = (text) => { $("msg").textContent = text || ""; };
  async function call(path, body) {
    const res = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}) });
    if (res.status === 202) return {};
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || data.title || m.failed);
    return data;
  }
  const go = (data) => { if (data.redirectTo) location.assign(data.redirectTo); };
  const hasPasskeys = typeof PublicKeyCredential !== "undefined" && "parseRequestOptionsFromJSON" in PublicKeyCredential;
  if (!hasPasskeys) { $("passkey").disabled = true; say(m.unsupported); }

  $("passkey").onclick = async () => {
    say("");
    try {
      const options = await call("/passkey/options", { mode: "login" });
      const credential = await navigator.credentials.get({ publicKey: PublicKeyCredential.parseRequestOptionsFromJSON(options) });
      go(await call("/passkey/verify", { credential: credential.toJSON() }));
    } catch (err) {
      if (err && err.name === "NotAllowedError") { say(m.noPasskey); $("create").hidden = false; } else say(err.message);
    }
  };
  $("create").onclick = async () => {
    say("");
    try {
      const options = await call("/passkey/options", { mode: "register" });
      const credential = await navigator.credentials.create({ publicKey: PublicKeyCredential.parseCreationOptionsFromJSON(options) });
      go(await call("/passkey/verify", { credential: credential.toJSON() }));
    } catch (err) { say(err.name === "NotAllowedError" ? m.failed : err.message); }
  };
  $("email-form").onsubmit = async (e) => {
    e.preventDefault(); say("");
    try { await call("/email/start", { email: $("email").value }); $("code-form").hidden = false; $("code").focus(); say(m.codeSent); }
    catch (err) { say(err.message); }
  };
  $("code-form").onsubmit = async (e) => {
    e.preventDefault(); say("");
    try { go(await call("/email/verify", { email: $("email").value, code: $("code").value })); } catch (err) { say(err.message); }
  };
  $("wallet").onclick = async () => {
    say("");
    if (!window.ethereum) return say(m.noWallet);
    try {
      const [address] = await window.ethereum.request({ method: "eth_requestAccounts" });
      const { message } = await call("/wallet/challenge", { address });
      const signature = await window.ethereum.request({ method: "personal_sign", params: [message, address] });
      go(await call("/wallet/verify", { message, signature }));
    } catch (err) { say(err.message || m.failed); }
  };
  $("cancel").onclick = async () => { try { go(await call("/abort")); } catch (err) { say(err.message); } };
})();`)}
</script>
</body>
</html>`;
}
