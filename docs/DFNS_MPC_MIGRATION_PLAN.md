# DFNS MPC Migration Plan — Replacing the Single Bridge Authority Key

Status: draft / for review
Owners: trace-solana-bridge (Node bridge), trace-backend (Laravel)
Related: `scripts/dfnsPing.js`, `trace-backend/app/Console/Commands/DfnsPing.php`

## 1. Current state (as implemented today)

- `src/config/solanaConfig.ts` loads a **single raw Ed25519 secret key** from
  `SOLANA_FEE_PAYER_SECRET_KEY` (a JSON array in `.env`), builds a `Keypair`,
  wraps it in an `anchor.Wallet`, and uses it as the `provider` for every
  Anchor program (`core`, `buyback`, `distribution`, `tracing`, `carbon`).
- That same keypair is used as **both**:
  1. the **fee payer** for every transaction, and
  2. the on-chain **`bridge_authority`** — the account checked by every
     mutating instruction (`create_organization`, `update_actor`,
     `delete_organization`, `register_validator`, etc. — see
     `src/idl/core.json`). Every one of these instructions documents
     `C-1: authority must equal bridge_config.bridge_authority`.
- All ~9 services (`OrganizationService`, `ActorService`, `BatchService`,
  `ClusterService`, `TransactionService`, `ValidatorService`,
  `DistributionService`, `BuybackService`, `TracingService`) call
  `.signers([feePayer])` directly and sign synchronously in-process.
- Laravel (`trace-backend`) never touches Solana directly. It talks to the
  bridge exclusively over HTTP, authenticated with a **shared HMAC secret**
  (`SolanaHmacService` ↔ `hmacAuth.ts` middleware,
  `X-HMAC-Signature` / `X-Timestamp`). This trust boundary is unaffected by
  this migration and should stay as-is.
- `SOLANA_FEE_PAYER_PUBKEY` is duplicated into `trace-backend/config/solana.php`
  (`fee_payer_pubkey`) purely to key the `solana_nonce_tracker` table used by
  `InitializeSolanaNonce` / `CloseOrphanedSolanaActors`.
- Both repos already have DFNS connectivity smoke tests
  (`scripts/dfnsPing.js`, `dfns:ping` artisan command) hitting
  `GET /wallets` with a bearer `DFNS_AUTH_TOKEN` — this is a legacy PAT-style
  check and is **not** the auth model we should use for production signing
  (see §3.1).

**Risk being addressed:** the raw secret key sits in plaintext in `.env` on
one host. Anyone with filesystem/process access (or a leaked `.env`) can
drain funds and impersonate the bridge authority permanently, with no
detection, no approval step, and no rotation story.

## 2. Critical architectural finding — read before implementing

The **PDA address of every entity is derived from the authority pubkey**,
not a fixed constant. From `src/idl/core.json`:

```
create_organization.organization.pda.seeds =
  [ "organization", account:authority, arg:org_id ]
update_organization.organization.pda.seeds  = (same)
delete_organization.organization.pda.seeds  = (same)
update_actor.actor.pda.seeds                = [ "actor", account:authority, arg:actor_id ]
```

(`OrganizationService.ts`, `ActorService.ts`, `BatchService.ts`,
`ClusterService.ts` all confirm this client-side: they build PDAs with
`feePayer.publicKey.toBuffer()` as a seed component.)

Combined with the `C-1` constraint (signer must equal
`bridge_config.bridge_authority`), this means: **if the bridge authority
pubkey ever changes, every instruction that mutates a pre-existing
organization/actor/cluster/batch will fail its seeds check**, because the
program will re-derive the expected PDA using the *new* authority pubkey,
which won't match the address that was actually created under the *old*
authority pubkey. Old accounts remain on-chain and readable forever, but
become **permanently non-mutable** under a new authority. There is no
migration instruction for this in the current IDL.

This has one very important, favorable consequence and one hard constraint:

- **Favorable:** DFNS's normal key "rotation" (proactive secret re-sharing
  among the MPC signing parties) **does not change the wallet's public
  key**. So routine DFNS rotation has **zero on-chain impact** — no seeds
  break, nothing needs `update_bridge_authority`. This is the rotation path
  we should use for anything routine (§6).
- **Hard constraint:** a genuine authority *replacement* — pointing
  `bridge_config.bridge_authority` at a different DFNS wallet/pubkey via the
  existing `update_bridge_authority` instruction — orphans every
  organization/actor/cluster/batch created before the switch from further
  updates/deletes under the new authority. This must be reserved for true
  one-time migration and emergency revocation (§5, §7), not treated as a
  routine operation, and stakeholders need to explicitly accept that
  pre-cutover records become update/delete-frozen (they stay readable and
  auditable). Flag this to the on-chain program owner now — a future program
  upgrade that decouples entity PDAs from the authority pubkey (e.g. seed on
  a stable namespace/nonce instead) would remove this limitation, but that's
  out of scope for this migration and should be tracked separately.

## 3. Target architecture

```
Laravel (trace-backend)                Node bridge (trace-solana-bridge)              DFNS
──────────────────────                ──────────────────────────────────             ────
SolanaHmacService  ──HMAC over HTTP──▶  Express routes (unchanged surface)
                                          │
                                          ▼
                                       *Service.ts (build Anchor ix, unsigned tx)
                                          │
                                          ▼
                                       DfnsSigningService  ──HTTPS + User Action Signing──▶  Wallet API
                                          │  (poll or webhook for SignatureRequest status)
                                          ▼
                                       attach signature → submit raw tx to Solana RPC
```

Key decision: **DFNS integration lives entirely inside the Node bridge**,
not Laravel. Laravel keeps talking HMAC-over-HTTP to the bridge exactly as
today — this migration is invisible to `SolanaHmacService`,
`UpdateMillingOnSolana`, and every controller/job in `trace-backend`. The
only Laravel-side changes are informational (§8.2).

### 3.1 DFNS auth model (two different tokens, don't conflate them)

DFNS has two distinct auth layers — the current ping scripts only exercise
the first one:

1. **Request authentication** — proves the caller is a registered DFNS
   Service Account. In production this should be a **Service Account** with
   its own asymmetric keypair, signing requests (not a long-lived static
   bearer PAT like the ping scripts use today). Rotate this credential
   independently of the Solana signing key (§6.3).
2. **User Action Signing** — required for *sensitive* calls specifically
   (creating a wallet, requesting a signature, changing policies). The
   caller must first request a challenge, sign it with a registered
   credential (a WebAuthn key for humans, or a Service Account signing key
   for server-to-server automation), and attach that signed assertion to the
   actual API call. This is what stands in for "the bridge proves it's
   allowed to ask for this specific signature" — it's the layer that lets us
   attach **policy approval** to individual transaction types (§4.2).

`DFNS_AUTH_TOKEN` in the current `.env.example`/ping scripts is fine for a
connectivity smoke test but must not become the credential used for
production signing calls — replace it with a Service Account key pair
before go-live.

### 3.2 New Node bridge component: `DfnsSigningService`

Add `src/services/DfnsSigningService.ts` responsible for:

- Holding the DFNS Service Account credentials (from env/secrets manager,
  never committed).
- `getWalletPublicKey(): Promise<PublicKey>` — resolves the DFNS Solana
  wallet's pubkey once at boot (replaces `feePayer.publicKey`).
- `signAndSubmit(tx: Transaction | VersionedTransaction): Promise<string>` —
  serializes the unsigned tx, requests a DFNS signature (with User Action
  Signing), polls/awaits completion, attaches the returned signature, and
  submits to the configured Solana RPC (or uses DFNS's broadcast capability
  if used instead of self-broadcasting — confirm current DFNS Solana support
  before deciding; either way the bridge needs the resulting `txSig` to
  return in the existing HTTP response shape).

### 3.3 Changes to `solanaConfig.ts` and the `*Service.ts` files

- Replace `feePayer` (a `Keypair`) and the `anchor.Wallet(feePayer)` /
  `AnchorProvider` sign-and-send flow with:
  - a **read-only** `bridgeAuthorityPubkey: PublicKey` (fetched from DFNS at
    boot, cached), used everywhere `feePayer.publicKey` is used today for
    PDA derivation and the `authority` account.
  - Anchor's `.transaction()` builder instead of `.rpc()`/`.signers([...])`
    in every service (`OrganizationService`, `ActorService`, `BatchService`,
    `ClusterService`, `TransactionService`, `ValidatorService`,
    `DistributionService`, `BuybackService`, `TracingService`,
    `ProgramService`) — build the instruction, wrap in a `Transaction`, set
    `feePayer`/blockhash, then hand off to `DfnsSigningService.signAndSubmit`
    instead of Anchor signing locally. This is a **mechanical but
    repo-wide** change; budget real review time for it (~9 files, dozens of
    call sites per the earlier grep).
  - No local secret key material anywhere in the bridge process after
    migration — `SOLANA_FEE_PAYER_SECRET_KEY` is deleted, not just unused.
- `GET /api/v1/admin/fee-payer` keeps working (returns the DFNS wallet's
  pubkey instead of a locally-derived one) — no route/contract change needed
  for Laravel.

## 4. Threshold signing setup

### 4.1 Key/wallet provisioning (one-time)

1. Create a DFNS **organization** (if not already done) and a **Service
   Account** dedicated to this bridge (name it distinctly, e.g.
   `trace-solana-bridge-prod`), with its own signing credential — don't
   reuse the ping-script token.
2. Create a DFNS **Wallet** with `network: Solana`. DFNS's MPC/TSS threshold
   signing (key shares split across DFNS's independent signing
   infrastructure) is managed internally — there's no customer-configured
   "N-of-M shares" for the standard multi-tenant offering; that's the whole
   point of using DFNS instead of self-hosting a threshold scheme. If the
   compliance/security bar requires the org to hold one of the key shares
   itself, evaluate DFNS's dedicated-cluster / self-hosted-signer offering
   separately — treat as a follow-up, not a blocker for this migration.
3. Record the resulting wallet pubkey. This becomes the new
   `bridge_authority` (§5).
4. Do this once for **devnet/staging** first, wire up the full flow
   end-to-end there, and only provision a **mainnet** production wallet
   after staging sign-off.

### 4.2 Policy Engine (the actual "threshold" control surface for us)

This is where multi-party approval actually gets configured for this
project — via DFNS Policies, not via customer-side MPC parameters:

- Define a policy on the wallet requiring **N-of-M approval** for
  `Wallets:Sign*` actions above a chosen risk bar. Practical split for this
  project:
  - **Auto-approve** (no human step) for routine, low-risk, high-volume
    writes already covered by HMAC + application-level auth: e.g.
    `create_actor`, `submit-batch`, `submit-drying`, milling updates — these
    are the bulk of daily bridge traffic (see `docs/ROUTES.md`) and gating
    every one on human approval would make the system unusable.
  - **Require approval** (e.g. 2-of-3 org admins) for anything
    high-blast-radius: `update_bridge_authority` itself, `admin/close`,
    buyback settlement/payment confirmation, and any instruction moving
    funds.
- Register the approver credentials (WebAuthn keys for named humans — e.g.
  eng lead + ops lead + a break-glass holder) in DFNS as part of this setup.
- This policy layer is what actually gives you defense-in-depth over "one
  compromised process key" — even if the Node bridge's Service Account
  credential leaks, high-risk actions still require a second, independent
  human signature.

### 4.3 Environment/config additions

Bridge (`trace-solana-bridge/.env`):
```
DFNS_API_URL=https://api.dfns.io          # or org-specific base URL
DFNS_SERVICE_ACCOUNT_ID=...
DFNS_SERVICE_ACCOUNT_PRIVATE_KEY=...      # or path to key file / secrets-manager ref
DFNS_WALLET_ID=...                        # the Solana wallet created in §4.1
# SOLANA_FEE_PAYER_SECRET_KEY removed entirely
```
Laravel (`trace-backend/.env`) — informational only, no signing capability:
```
SOLANA_FEE_PAYER_PUBKEY=<dfns wallet pubkey>   # keeps solana_nonce_tracker keyed correctly
```

Use whatever secrets manager the deployment already relies on for
`DFNS_SERVICE_ACCOUNT_PRIVATE_KEY` and `BRIDGE_HMAC_SECRET` — don't newly
introduce plaintext `.env` for this one credential while everything else
stays plaintext; if there's no secrets manager in place yet, at minimum
match the current handling and flag it as a follow-up.

## 5. Cutover procedure (single key → DFNS, one-time)

Do this on staging first, verbatim, before touching production.

1. Provision the DFNS Solana wallet (§4.1) and confirm `DfnsSigningService`
   can sign+submit a trivial instruction on devnet.
2. **Freeze writes**: pause queue workers / put the bridge in maintenance
   mode so no transactions are in-flight against the old authority.
3. Call `update_bridge_authority` **using the current (old) local key**,
   passing the new DFNS wallet pubkey as `new_authority`. This is the last
   time the raw private key is ever used.
4. Verify on-chain: fetch `bridge_config`, confirm `bridge_authority` now
   equals the DFNS wallet pubkey (`getProgramConfig()` in `ProgramService.ts`
   already exposes this).
5. Deploy the new bridge build (DFNS-backed signing, no local key). Update
   `SOLANA_FEE_PAYER_PUBKEY` in Laravel's config to the DFNS wallet pubkey.
6. Smoke test the full read/write surface against devnet/staging programs:
   create+update+delete on at least one actor, organization, cluster, and
   batch, to prove new-authority PDAs (§2) work end-to-end.
7. Unfreeze writes.
8. **Destroy the old raw secret key material**: remove it from `.env`,
   secrets manager, backups, shell history, and any local machine it was
   generated/copied on. Confirm nobody still has a copy before this step —
   treat it as irreversible.
9. Document, in this file or a linked runbook, the exact old→new pubkey
   pair and the cutover date/tx signature, since it's the permanent
   boundary between "mutable" and "frozen" entities per §2.

## 6. Routine key rotation procedure

Two distinct things get called "rotation" here — keep them separate:

### 6.1 DFNS share rotation (routine, cheap, no on-chain impact)

- Trigger DFNS's key resharing/rotation for the wallet on whatever cadence
  the org's key-management policy requires (e.g. quarterly, or after any
  suspected-but-unconfirmed exposure of the Service Account credential).
- The wallet's public key **does not change** — no `update_bridge_authority`
  call needed, no PDA impact, no downtime. This should be the default,
  low-friction rotation path and can likely be scripted/scheduled.
- Confirm with current DFNS docs whether this is self-service via API or
  requires a support request, and record the answer here once known.

### 6.2 DFNS Service Account credential rotation (routine, bridge-side)

- Rotate `DFNS_SERVICE_ACCOUNT_PRIVATE_KEY` independently — this is the
  bridge's *own* auth credential to DFNS, unrelated to the Solana wallet
  key. Standard secret-rotation practice: provision new Service Account
  credential, deploy, revoke old credential in DFNS, confirm no auth
  failures in bridge logs.

### 6.3 Full authority replacement (rare — only if truly necessary)

Only do this if the DFNS wallet itself needs to change (e.g. moving to a
new DFNS org, or emergency revocation per §7). Follow the cutover procedure
in §5 again, end to end, including the explicit "pre-cutover entities become
frozen" acknowledgment.

## 7. Emergency revocation process

Trigger conditions: suspected compromise of the DFNS Service Account
credential, suspected compromise of an approver's WebAuthn credential, or
any signal that an unauthorized signature could be produced.

1. **Contain immediately, in DFNS, not on-chain first:**
   - Revoke/deactivate the suspected Service Account credential in DFNS
     (stops the bridge from being able to request new signatures at all —
     fastest possible stop, independent of Solana).
   - If an approver credential is suspected, revoke it and tighten the
     policy quorum temporarily (e.g. require the remaining trusted
     approvers only) until a replacement is registered.
   - Put the bridge in maintenance mode (same mechanism as §5 step 2) so no
     queued Laravel jobs retry into a broken/paused signer and pile up
     `solana_status = FAILED` noise — reconcile those after containment.
2. **Assess** whether the wallet's private key material itself is believed
   compromised (as opposed to just the request-auth credential). Under
   DFNS's MPC model this is a much higher bar — a single leaked Service
   Account credential does not equal a leaked key share — but if there's
   genuine reason to believe key material or enough shares are compromised:
3. **Revoke on-chain authority**: if any legitimate signing path still
   exists (old wallet not fully compromised, or a break-glass credential is
   available), immediately call `update_bridge_authority` to move
   `bridge_config.bridge_authority` to a freshly provisioned, isolated DFNS
   wallet created for exactly this purpose. This is the on-chain circuit
   breaker — after this call, no signature from the compromised wallet can
   mutate `bridge_config`-gated state, regardless of what happens to the old
   key.
   - If *no* legitimate signing path exists (worst case — total loss of
     signing capability), there is no way to call `update_bridge_authority`
     at all; this is a real gap and worth deciding now, before an incident,
     whether to keep a cold/offline break-glass credential (e.g. a
     hardware-secured key or a DFNS credential intentionally kept out of
     day-to-day use) precisely so this circuit breaker is always reachable.
     Flag this as an open decision (§9).
4. **Reconcile**: replay/retry any Laravel jobs that failed during the
   freeze (`UpdateMillingOnSolana` and similar `ShouldQueue` jobs already
   mark `solana_status = FAILED` and are safe to redispatch).
5. **Post-incident**: rotate every credential touched (Service Account key,
   any approver credentials in scope, `BRIDGE_HMAC_SECRET` out of an
   abundance of caution even though it's a separate trust boundary), and
   write up the timeline against this runbook so gaps get fixed before the
   next incident.

## 8. Implementation checklist

### 8.1 `trace-solana-bridge`
- [ ] Add DFNS SDK dependency; add `DfnsSigningService.ts`.
- [ ] Update `solanaConfig.ts`: drop `feePayer`/`wallet`/local `AnchorProvider`
      signing, expose `bridgeAuthorityPubkey` resolved from DFNS at boot.
- [ ] Update all 9+ `*Service.ts` files: `.rpc()` + `.signers([feePayer])` →
      build `.transaction()` + `DfnsSigningService.signAndSubmit(...)`.
- [ ] Update `ProgramService.getFeePayerPublicKey` (or rename, keeping the
      `/admin/fee-payer` route contract stable) to read from DFNS wallet.
- [ ] Remove `SOLANA_FEE_PAYER_SECRET_KEY` from `.env`/`.env.example`; add
      the DFNS env vars from §4.3.
- [ ] Promote `scripts/dfnsPing.js` from ad hoc script to a real Service
      Account-based health check (or replace it — it currently uses a
      static bearer token, not the production auth model).
- [ ] Add integration tests against DFNS's sandbox/testnet environment for
      the sign+submit path.

### 8.2 `trace-backend`
- [ ] Update `SOLANA_FEE_PAYER_PUBKEY` post-cutover (§5 step 5) — this is
      the only required change; `SolanaHmacService`, jobs, and controllers
      are untouched.
- [ ] Same note for `DfnsPing.php`/`config/services.php` as the bridge-side
      ping script — fine as a smoke test, not the production auth path.
- [ ] No changes needed to `SolanaNonceTracker`/`InitializeSolanaNonce`
      beyond the pubkey value, since it's keyed by pubkey string.

### 8.3 Docs/runbooks
- [ ] Link this file from `trace-backend/.env.example` (already references
      it) and from `trace-solana-bridge/docs/ROUTES.md`.
- [ ] Record the actual old→new pubkey mapping and cutover tx signature
      here once §5 is executed (currently unknown/pending).

## 9. Open question 

- Who holds the break-glass credential from §7 step 3, and where is it
  stored (must be reachable during an incident but not part of normal
  operations)?
