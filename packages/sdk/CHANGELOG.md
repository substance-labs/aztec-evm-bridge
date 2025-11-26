# @substancelabs/aztec-evm-bridge-sdk

## 1.0.0

### Major Changes

- f3429b0: Release of SDK v1.x

  **BREAKING CHANGES:**
  - Bridge constructor is now private - use `Bridge.create()` async factory method instead
  - Bridge now requires `aztecWallet` (Wallet instance) instead of aztec connection parameters
  - Removed deprecated parameters: `aztecNodeUrl`, `aztecPxeStoreDirectory`, `aztecKeySalt`, `aztecSecretKey`

  **New Features:**
  - Added browser E2E test support
  - Added documentation (DOCUMENTATION.md)

  **Improvements:**
  - Refactored Bridge to use Wallet interface for better compatibility
  - Improved error handling and validation
  - Added polyfills for browser compatibility
  - Updated TypeScript types and exports

  **Migration Guide:**

  ```typescript
  // Before
  const bridge = new Bridge({
    aztecNodeUrl: "...",
    aztecPxeStoreDirectory: "...",
    aztecSecretKey: "0x...",
    evmPrivateKey: "0x...",
  })

  // After
  import { createWallet } from "@aztec/aztec.js"

  const wallet = await createWallet(pxe, encryptionPrivateKey, accountContract, salt)

  const bridge = await Bridge.create({
    aztecWallet: wallet,
    evmPrivateKey: "0x...",
  })
  ```

## 0.0.2

### Patch Changes

- c9fb1e7: Refactor SDK for improved readability and maintainability
  - Extract operation classes: AztecToEvmOperations, EvmToAztecOperations, ForwardOperations
  - Add service classes: AztecService, EvmService for wallet management
  - Add BridgeHelpers utility class for common operations
  - Extract LogQueries utilities for Aztec log queries
  - Improve code organization and separation of concerns
  - Add allowance verification retry logic
  - Fix nonce management in order filling
