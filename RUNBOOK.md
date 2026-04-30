# Solana Bridge — Runbook

## Overview

The Solana Bridge is a Node.js/Express service that acts as the authenticated middleware between the Laravel backend (PHP) and the on-chain Solana programs. All state-mutating calls require HMAC-SHA256 authentication.

---

## Prerequisites

| Requirement | Version |
|---|---|
| Node.js | ≥ 20 |
| npm | ≥ 10 |
| Solana CLI | any (for key generation only) |
| Network access | Solana Devnet or Mainnet RPC |

---

## First-Time Setup

### 1. Install dependencies

```bash
cd solana_bridge
npm install
```

### 2. Configure environment

Copy the example and fill in values:

```bash
cp .env.example .env   # if it exists, otherwise create .env manually
```

Required `.env` fields:



### 2. Initialize bridge config on-chain (one-time, per program, per network)

Before the bridge can submit any transactions, the on-chain `bridge_config` PDA must be initialized with the fee payer's public key. Call:

```
POST /api/v1/admin/initialize
```

with HMAC auth. This only needs to be done once per deployment.

---

## Running the Server

### Development (uses .env automatically)

```bash
npm run dev
```

### Production

```bash
NODE_ENV=production npm run start
```

> For production, run behind a process manager like PM2:
> ```bash
> pm2 start dist/server.js --name solana-bridge --env production
> ```

---

## Verifying the Server is Up

```bash
curl http://localhost:3000/health
```

Expected response:
```json
{ "status": "OK", "solana": "Connected", "timestamp": "..." }
```

```bash
curl http://localhost:3000/api/v1/check-init-status
```

---

## HMAC Authentication

All `POST` endpoints (except `SKIP_HMAC_AUTH=true`) require two headers:

| Header | Value |
|---|---|
| `X-HMAC-Signature` | HMAC-SHA256 hex of `{timestamp}.{raw_body}` |
| `X-Timestamp` | Current Unix time in **milliseconds** |

**Signing formula (PHP example):**

```php
$timestamp = (string)(time() * 1000);  // milliseconds
$body      = json_encode($payload);    // must be the exact string sent as the body
$dataToSign = $timestamp . '.' . $body;
$signature  = hash_hmac('sha256', $dataToSign, env('BRIDGE_HMAC_SECRET'));

$headers = [
    'X-HMAC-Signature: ' . $signature,
    'X-Timestamp: '      . $timestamp,
    'Content-Type: application/json',
];
```

Requests older than **5 minutes** are rejected.

---

## API Endpoints

Base path: `POST /api/v1/...` — all mutating endpoints require HMAC auth unless noted.

### Admin

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/admin/initialize` | HMAC | Initialize bridge config on-chain (one-time) |
| GET | `/admin/status` | None | Program initialization status |
| GET | `/admin/fee-payer` | None | Bridge fee payer public key |
| POST | `/test-connection` | HMAC | Test RPC connectivity |

### Actors (Core Program)

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/submit-actor` | HMAC | Register a new actor (farmer, staff, etc.) |
| GET | `/check-actor/:actorId` | HMAC | Check if actor exists on-chain |
| GET | `/get-actor/:actorId` | HMAC | Fetch actor account data |
| POST | `/update-actor` | HMAC | Update actor fields |
| POST | `/delete-actor` | HMAC | Soft-delete an actor |
| POST | `/close-actor` | HMAC | Close actor account and reclaim rent |

### Organizations (Core Program)

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/submit-organization` | HMAC | Register a new organization |
| POST | `/update-organization` | HMAC | Update organization fields |
| POST | `/delete-organization` | HMAC | Delete an organization |

### Buybacks (Buyback Program)

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/submit-buyback` | HMAC | Create a buyback agreement on-chain |
| GET | `/check-buyback/:buybackId` | None | Check if buyback account exists |
| GET | `/get-buyback/:buybackId` | None | Fetch buyback account data |
| POST | `/update-in-season` | HMAC | Log a risk event / yield forecast update |
| POST | `/settle-buyback` | HMAC | Record harvest settlement data |
| POST | `/confirm-buyback-payment` | HMAC | Confirm payment was made |
| POST | `/update-payment-schedule` | HMAC | Reschedule payment date |
| POST | `/mark-buyback-settled` | HMAC | Mark a to_settle/pay_later as fully settled |
| POST | `/delete-buyback` | HMAC | Soft-cancel a buyback |
| POST | `/close-buyback` | HMAC | Close account and reclaim rent |

### Other Modules

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/submit-batch` | HMAC | Register a harvest batch |
| POST | `/submit-transaction` | HMAC | Record a transaction |
| POST | `/submit-distribution` | HMAC | Record a distribution event |
| POST | `/submit-cluster` | HMAC | Register a cluster |
| POST | `/submit-validator` | HMAC | Register a validator |

Full Swagger docs available at: `http://localhost:3000/api-docs`

---

## Buyback Lifecycle & Payload Reference

Buybacks must be called **in order** — each downstream call will fail with `AccountNotInitialized` if `submit-buyback` hasn't succeeded first.

### 1. `/submit-buyback`

```json
{
  "buyback_id": "9000000000001",
  "farmer_id": "1",
  "rsbsa_number": "0",
  "provider_id": "1",
  "season_id": "1",
  "farm_size_hectares": "10000",
  "pb_borrowed_price": "0",
  "premium_per_kg": "1000000",
  "input_details": "[]",
  "expected_harvest_kg": "100000000",
  "contract_pdf_key": "",
  "farmer_signature_key": "",
  "staff_signature_key": ""
}
```

All numeric fields sent as **strings**. Returns `202` on success.

### 2. `/update-in-season`

```json
{
  "buyback_id": 9000000000001,
  "risk_event": "Typhoon",
  "forecasted_yield": 500500,
  "major_risk_flag": 1
}
```

`major_risk_flag`: 0=none, 1=drought, 2=flood, 3=pest. Omit or set `255` to skip updating it.

### 3. `/settle-buyback`

```json
{
  "buyback_id": 9000000000001,
  "actual_harvest_kg": 95000000,
  "pm_market_price": 2500,
  "check_number": "CHK-001",
  "check_date": 1767139200,
  "new_status": 3,
  "target_payment_date": 1767139200,
  "total_price_signed": 237500000,
  "contract_pdf_key": "",
  "farmer_signature_key": "",
  "staff_signature_key": ""
}
```

`new_status`: 1=settled, 3=to_settle, 4=pay_later. `total_price_signed` must match the on-chain calculation within 10 cents.

### 4. `/update-payment-schedule`

```json
{
  "buyback_id": 9000000000001,
  "target_payment_date": 1767139200
}
```

`target_payment_date` as Unix timestamp (seconds). ISO date strings (`"2025-12-31"`) are also accepted and auto-converted.

### 5. `/mark-buyback-settled`

```json
{ "buyback_id": 9000000000001 }
```

### 6. `/delete-buyback` / `/close-buyback`

```json
{ "buyback_id": 9000000000001 }
```

---

## Rebuilding After Code Changes

Any change to `src/` requires a rebuild before it takes effect:

```bash
npm run build   # compiles src/ → dist/
npm run dev     # restart the server
```

---

## Running Tests

```bash
npm test
```

Tests use Jest with mocked Solana config. No live RPC calls.

---

## Common Errors

| Error | Cause | Fix |
|---|---|---|
| `AccountNotInitialized` | Lifecycle call made before `submit-buyback` succeeded | Fix upstream failure first |
| `AccountDidNotDeserialize` | Buyback account exists but program IDL changed | Redeploy program or use correct IDL |
| `Unauthorized` | `authority` doesn't match `bridge_config.bridge_authority` | Reinitialize or ensure correct fee payer keypair |
| `Access violation in stack frame 5` | Stack overflow in Rust program | Redeploy program with `Box<Account>` wrapping |
| `BuybackNotActive` | Operation called on wrong status | Check current status with `/get-buyback/:id` |
| `PriceMismatch` | `total_price_signed` doesn't match on-chain formula | Recalculate: `(kg × market_price / 1000) + (kg × premium / 1000) - borrowed` |
| `Invalid HMAC signature` | Secret mismatch or wrong signing formula | Verify `BRIDGE_HMAC_SECRET` matches on both sides |
| `Request timestamp expired` | Request older than 5 minutes | Re-sign with current timestamp |

---

## Environment Variables Reference

| Variable | Required | Description |
|---|---|---|
| `SOLANA_RPC_URL` | Yes | Solana RPC endpoint |
| `SOLANA_FEE_PAYER_SECRET_KEY` | Yes | JSON array of 64 bytes |
| `SOLANA_CORE_PROGRAM_ID` | Yes | Core program address |
| `SOLANA_BUYBACK_PROGRAM_ID` | Yes | Buyback program address |
| `SOLANA_DISTRIBUTION_PROGRAM_ID` | Yes | Distribution program address |
| `SOLANA_TRACING_PROGRAM_ID` | Yes | Tracing program address |
| `SOLANA_CARBON_PROGRAM_ID` | Yes | Carbon program address |
| `NODE_SERVICE_PORT` | No | Server port (default: 3000) |
| `BRIDGE_HMAC_SECRET` | Yes | Shared secret for HMAC auth |
| `SKIP_HMAC_AUTH` | No | `true` to bypass auth (dev only) |
| `NODE_ENV` | No | Set to `production` to disable debug logs |
