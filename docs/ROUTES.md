# Routes (HTTP API)

This service exposes an Express HTTP API, primarily used as a “bridge” layer to submit/check/update records on Solana programs.

## Base URLs

- **Root**: `GET /` → service banner text
- **Health**: `GET /health` → includes Solana connectivity/initialization signal
- **API v1 base**: all routes below are mounted under **`/api/v1`**
- **Swagger UI**: `GET /api-docs` (served by `swagger-ui-express`)

## Authentication (HMAC)

Most mutating routes require **HMAC authentication** via `verifyHmac` middleware.

- **Required headers**:
  - `x-hmac-signature`: hex HMAC-SHA256
  - `x-timestamp`: unix timestamp in **milliseconds**
  - `x-hmac-nonce`: unique 16-128 character request identifier
- **Signing format**: HMAC over the exact string:

  `"{UPPERCASE_METHOD}\n{originalPathAndQuery}\n{timestamp}\n{nonce}\n{rawBodyJsonString}"`

  where `rawBodyJsonString` is the **raw request body** as received (the server captures it before JSON parsing).
- **Replay protection**: requests older than ~5 minutes and reused nonces are rejected.
- **Dev bypass**: requires both `SKIP_HMAC_AUTH=true` and `NODE_ENV=development` or `test`.

## Routes

Legend for “Auth”:

- **HMAC**: `verifyHmac` required
- **LOG**: `logRequest` only (logs, no auth)
- **NONE**: no middleware

### Program / Admin

- **POST** `/api/v1/admin/initialize` — **HMAC**
- **GET** `/api/v1/admin/status` — **LOG**
- **GET** `/api/v1/admin/fee-payer` — **LOG**
- **DELETE** `/api/v1/admin/close` — **HMAC**
- **GET** `/api/v1/check-init-status` — **LOG**
- **POST** `/api/v1/test-connection` — **HMAC**

### Actors

- **POST** `/api/v1/submit-actor` — **HMAC**
- **GET** `/api/v1/check-actor/:actorId` — **HMAC**
- **GET** `/api/v1/get-actor/:actorId` — **HMAC**
- **POST** `/api/v1/update-actor` — **HMAC**
- **POST** `/api/v1/delete-actor` — **HMAC**
- **POST** `/api/v1/close-actor` — **HMAC**

### Batches

- **POST** `/api/v1/submit-batch` — **HMAC**
- **GET** `/api/v1/check-batch/:batchId` — **HMAC**
- **GET** `/api/v1/get-batch/:batchId` — **HMAC**
- **POST** `/api/v1/update-batch` — **HMAC**
- **POST** `/api/v1/delete-batch` — **HMAC**
- **POST** `/api/v1/close-batch` — **HMAC**

### Tracing (Drying / Milling / Season)

Drying:

- **POST** `/api/v1/submit-drying` — **HMAC**
- **GET** `/api/v1/check-drying/:dryingId` — **HMAC**
- **GET** `/api/v1/get-drying/:dryingId` — **HMAC**
- **POST** `/api/v1/update-drying` — **HMAC**
- **POST** `/api/v1/delete-drying` — **HMAC**
- **POST** `/api/v1/close-drying` — **HMAC**

Milling:

- **POST** `/api/v1/submit-milling` — **HMAC**
- **GET** `/api/v1/check-milling/:millingId` — **HMAC**
- **GET** `/api/v1/milling/:millingId` — **HMAC**
- **PUT** `/api/v1/milling/:millingId` — **HMAC**
- **DELETE** `/api/v1/milling/:millingId` — **HMAC**
- **DELETE** `/api/v1/milling/:millingId/close` — **HMAC**

Season:

- **POST** `/api/v1/submit-season` — **HMAC**
- **GET** `/api/v1/check-season/:seasonId` — **HMAC**
- **GET** `/api/v1/get-season/:seasonId` — **HMAC**
- **POST** `/api/v1/update-season` — **HMAC**
- **POST** `/api/v1/delete-season` — **HMAC**
- **POST** `/api/v1/close-season` — **HMAC**

### Transactions

- **POST** `/api/v1/submit-transaction` — **HMAC**
- **POST** `/api/v1/add-transaction` — **HMAC**
- **POST** `/api/v1/update-transaction` — **HMAC**
- **GET** `/api/v1/check-transaction/:nonce` — **HMAC**

### Buybacks

The legacy mutable Anchor BUYBACK routes are intentionally not mounted. BUYBACK proofs are
written only by the durable Laravel outbound worker described in the repository README.

### Organizations (Core program)

- **POST** `/api/v1/submit-organization` — **HMAC**
- **POST** `/api/v1/update-organization` — **HMAC**
- **POST** `/api/v1/delete-organization` — **HMAC**

### Validators (Core program)

- **POST** `/api/v1/register-validator` — **HMAC**
- **POST** `/api/v1/update-validator` — **HMAC**
- **POST** `/api/v1/deactivate-validator` — **HMAC**

### Clusters (Core program)

- **POST** `/api/v1/submit-cluster` — **HMAC**
- **POST** `/api/v1/add-farmer-to-cluster` — **HMAC**

### Distribution

Performance:

- **POST** `/api/v1/submit-actor-performance` — **HMAC**
- **POST** `/api/v1/record-delivery-performance` — **HMAC**

Distributions:

- **POST** `/api/v1/submit-distribution` — **HMAC**
- **POST** `/api/v1/update-delivery-status` — **HMAC**
- **POST** `/api/v1/confirm-receipt` — **HMAC**
- **POST** `/api/v1/link-to-chain` — **HMAC**
- **POST** `/api/v1/delete-distribution` — **HMAC**

Checkpoints:

- **POST** `/api/v1/submit-checkpoint` — **HMAC**
- **POST** `/api/v1/delete-checkpoint` — **HMAC**

## Notes on Swagger docs

Swagger is generated from annotations in `src/controllers/*.ts` and route files in `src/routes/*.ts`.
If you see any mismatch between the UI paths and the runtime paths, the **runtime truth is the Express routers** under `src/routes/`.

