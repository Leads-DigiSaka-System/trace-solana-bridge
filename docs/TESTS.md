# Tests

This repo uses **Jest** with **ts-jest** to run TypeScript tests in an **ESM** (`"type": "module"`) Node environment.

## How to run

Install dependencies:

```bash
npm install
```

Run all tests:

```bash
npm test
```

The `test` script uses Node’s ESM/Jest compatibility flag:

- `node --experimental-vm-modules node_modules/jest/bin/jest.js`

## Test configuration

Key settings in `jest.config.js`:

- **preset**: `ts-jest`
- **environment**: `node`
- **roots**: `src/` and `tests/`
- **testMatch**: `*.test.ts` / `*.spec.ts` (plus JS variants)
- **ESM transform**: `ts-jest` with `useESM: true`
- **moduleNameMapper**: strips `.js` from relative imports so TS/ESM source that imports `../x.js` can map to `../x.ts` during tests.

## What the tests cover

Current tests are **service-level unit tests** that validate:

- **PDA derivations** (using `PublicKey.findProgramAddressSync`)
- **Anchor method wiring** (that the service calls the expected Anchor instruction builder)
- **RPC submission flow** (`.rpc()` returning a mocked tx signature)
- **Existence checks** where applicable (`connection.getAccountInfo`)

Files:

- `tests/TransactionService.test.ts`
- `tests/BatchService.test.ts`
- `tests/DistributionService.test.ts`
- `tests/CoreServices.test.ts` (Organization/Validator/Cluster services)

## Mocking strategy (important)

Because the codebase is ESM, the tests use:

- `jest.unstable_mockModule("../src/config/solanaConfig.js", () => ({ ... }))`
- followed by **dynamic imports**:
  - `const { someFn } = await import("../src/services/SomeService.js");`

This pattern ensures the mocked `solanaConfig` module is applied **before** the service module is evaluated.

The mock module typically provides:

- `feePayer.publicKey` / `wallet.publicKey`
- `connection.getAccountInfo` (as a jest mock)
- program stubs like `tracingProgram.methods.*`, `distributionProgram.methods.*`, `coreProgram.methods.*`

## Writing a new test

1. Add a new file under `tests/`, e.g. `tests/MyService.test.ts`.
2. Mock `../src/config/solanaConfig.js` with the minimal set of fields your service imports/uses.
3. Dynamically `await import()` the service module **after** mocking.
4. Stub Anchor instruction builders to return the fluent shape used by services:

```ts
someProgram.methods.someInstruction.mockReturnValue({
  accounts: jest.fn().mockReturnThis(),
  signers: jest.fn().mockReturnThis(),
  rpc: jest.fn().mockResolvedValue("mock_tx_sig"),
});
```

5. Assert:
   - the returned signature equals `"mock_tx_sig"`
   - `.accounts(...)` was called with the expected PDAs/keys
   - `.methods.<instruction>` was invoked as expected

## Troubleshooting

- **`SyntaxError: Cannot use import statement outside a module`**:
  - Ensure you are running via `npm test` (it includes the Node flag used here).
  - Keep tests as ESM-compatible (this repo uses `"type": "module"`).

- **Mocks not applied**:
  - Make sure the `jest.unstable_mockModule(...)` call happens before the `await import(...)`.

