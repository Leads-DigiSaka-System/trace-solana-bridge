# DigiSaka Solana bridge

The BUYBACK integration runs as a durable outbound worker:

```text
Laravel blockchain_outbound -> this worker -> Solana Memo program -> Laravel confirm/fail
```

Laravel remains authoritative. Solana receives a deterministic memo containing only the
outbound id, domain, subject id, version, payload hash, and previous hash. The canonical
buyback payload, names, banking fields, documents, and signatures are never put on-chain.

## Run the BUYBACK worker

1. Copy `.env.example` to `.env` and issue a dedicated Laravel Sanctum token with the
   configured blockchain bridge ability.
2. Store the Solana fee payer JSON outside the repository and set `SOLANA_KEYPAIR_PATH`.
3. Fund the fee payer on the configured cluster.
4. Build and start:

```shell
npm run build
npm start
```

Use a process supervisor (systemd, Supervisor, PM2, or a container restart policy). Mount
`OUTBOUND_JOURNAL_PATH` on persistent storage. The journal plus finalized transaction-history
scan prevents duplicate submissions when a transaction succeeds but its Laravel callback fails.
The worker atomically locks that stable path for its lifetime; a second live process using the
same journal fails startup. Prefer one singleton worker. If replicas are intentionally deployed,
give each replica a unique persistent (non-PID-derived) journal path. Stale locks are recovered
automatically only when a dead PID can be proven on the same host; unverifiable locks fail closed.
Without an explicit path, the stable default is cluster-specific
(`./data/outbound-anchor-journal-<network>.json`).
The worker persists each signed transaction before broadcasting it. If finalized transaction
details are temporarily unavailable from RPC, recovery verifies or resends those identical signed
bytes rather than creating another transaction. Keep `OUTBOUND_CLAIM_TTL_MS` equal to Laravel's
`SOLANA_BUYBACK_CLAIM_TTL` (converted from seconds to milliseconds); startup rejects a
request, Solana RPC, reconciliation, and confirmation time budget that could outlive that lease.
An unbroadcast prepared transaction is replaced only after full-history status is absent and its
blockhash is objectively expired; bounded memo reconciliation runs before replacement. Finalized
journal records are removed only after Laravel acknowledges the confirmation.
Every prepared and finalized journal record is bound to the exact configured Solana network.
Legacy records without provenance and records from another cluster remain quarantined: they are
never rebroadcast or used for callback replay. Use a dedicated persistent journal path per cluster.
Finalized journal entries whose callback response was lost are replayed idempotently at startup;
they remain on disk until Laravel acknowledges the exact signature, payload hash, and original
canonical fee-payer address. Missing or invalid original addresses are quarantined, never guessed.
Leave `OUTBOUND_WORKER_ID` unset to use the safe `hostname:pid` default, or assign a value that is
globally unique to each simultaneously running process/replica. Never reuse one worker ID across
live replicas. Explicit IDs may contain only `A-Z`, `a-z`, `0-9`, `.`, `_`, `:`, and `-`, matching
Laravel's claim contract. An exhausted lease is returned as recovery-only: the worker may verify a journaled
or already-finalized signature, but it will fail terminally instead of broadcasting fresh bytes.

The worker fails closed when credentials, network, or endpoints are inconsistent. Mainnet is
locked unless `ALLOW_SOLANA_MAINNET=true` is explicitly set. Perform the cutover on devnet first.
If the fee payer drains after startup, the current row is retained as retryable and the worker
opens a fatal funding circuit before claiming another row. Supervisor restarts then fail the
startup balance check until the configured account is funded again.

For the first deployment, stop every legacy bridge/Polygon BUYBACK worker before exposing the new
Laravel outbox API. Deploy the matching Laravel and bridge versions together, complete the database
preflight/migration, and only then start this worker. The `recovery_only` claim contract is
intentionally fail-closed and is not compatible with an older worker that does not understand it.

## Laravel callback contract

The worker polls `GET /api/outbound/blockchain/pending`, claims one row at a time, retrieves its
authenticated canonical payload, and verifies its SHA-256. It reports a finalized transaction
through `POST .../confirm` with `worker_id`, `payload_hash`, signature, slot, fee-payer address,
commitment, and timestamp. Failures are classified as retryable or terminal through `POST .../fail`.
The pending response must report `data.claim_ttl_ms` exactly matching `OUTBOUND_CLAIM_TTL_MS`;
missing or mismatched lease configuration stops processing before any claim.

## Legacy HTTP API

`npm start` now runs the outbound worker. The old HTTP API can be run separately with `npm run api`.
The old custom Anchor BUYBACK routes are no longer mounted. They represented a second mutable
source of truth and must not be used after the durable-outbox cutover. Other legacy routes remain
available for now and use strengthened HMAC authentication:

```text
METHOD + "\n" + ORIGINAL_URL + "\n" + X_TIMESTAMP + "\n" + X_HMAC_NONCE + "\n" + RAW_BODY
```

Sign this string with HMAC-SHA256 and send lowercase hexadecimal in `X-HMAC-Signature`.
Nonces are single-use within the timestamp window. Authentication bypass works only when both
`SKIP_HMAC_AUTH=true` and `NODE_ENV` is `development` or `test`.

## Security

- Never commit `.env`, a keypair, bearer token, or HMAC secret.
- Prefer `SOLANA_KEYPAIR_PATH`; inline `SOLANA_FEE_PAYER_SECRET_KEY` is compatibility-only.
- Rotate any key that has ever been committed, then purge it from Git history separately.
- Never point `LARAVEL_PAYLOAD_ORIGIN` at an untrusted host; the bearer token is sent only to
  explicitly allowed Laravel origins and only on the expected payload route.
