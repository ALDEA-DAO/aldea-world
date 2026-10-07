# Changelog

What changes for whoever plays, forks or operates ALDEA World. Versions are the ones registered in the Atlas.

## 0.1.0 (not released yet)

The first version proposed as official: the one the Genesis Charter ratifies.

### The world

- **Sign in with ALMA.** A passkey, an email code or a wallet you already have; the soul is the account, and keys
  are linked to it and removed from it in the Soul Registry.
- **Birth.** One person, one character: choose one of eleven classes, and the tribe is drawn from a Base block that
  does not exist yet when you ask. No wallet to install and nothing to pay.
- **The village.** An isometric village to walk, with the Town Center, the Soul Registry, the Portal of Worlds and
  the Council; two more buildings under construction, each with its waitlist. List mode offers the same buildings and
  actions without the canvas.
- **The Atlas and the Portal.** Worlds, their versions and the clients that serve them, registered on Base; travel
  to another world with a warning when it is not verified. This client says whether it is the official version.
- **Founders.** Link a Cardano wallet with a signature and, with enough $ALDEA, claim the Founder seal. During
  Genesis Week, Founders are born first.
- **The Council.** Founders sign or object to the Genesis Charter with their Cardano wallet, without paying. The tally
  is public and recomputable; an approved result is executed after a delay in which the Safe can veto.
- **Around it.** A welcome for guests, settings (language, theme, motion), About with who holds each power, Terms
  and Privacy (drafts under legal review), a soul card to share, Spanish and English throughout.

### For operators

- Every service answers `/alerts` for uptime monitors; errors go to Sentry when configured.
- The Resolver rate-limits sign-in and the API and sends security headers; the client is built with its
  Content-Security-Policy.
- Templates for the Safe's transactions in `infra/safe`.

### For forks

- The fork kit (`AdaSouls/fork-kit`) registers a world, its versions and its clients in the Atlas; see FORKING.md.
