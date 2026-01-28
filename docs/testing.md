# Testing Guide

This guide covers unit testing and end-to-end (E2E) testing for the Aztec-EVM Bridge.

## Overview

The bridge includes multiple testing layers:

| Package | Test Type | Command |
| ------- | --------- | ------- |
| `packages/evm` | Solidity unit tests | `forge test` |
| `packages/aztec/aztec_gateway_7683` | Noir + JS integration tests | `yarn test` |
| `packages/filler` | TypeScript unit tests | `yarn test` |
| `packages/sdk` | Browser + Node tests | `yarn test` |
| Root | E2E bridge tests | `yarn test:bridge` |

## Unit Testing

### EVM Contracts (Foundry)

Run all Solidity tests:

```bash
cd packages/evm
forge test
```

Run with verbosity for detailed output:

```bash
forge test -vvv
```

Run specific test file:

```bash
forge test --match-path test/L2Gateway7683.t.sol
```

Run specific test function:

```bash
forge test --match-test testOpenOrder
```

Generate coverage report:

```bash
forge coverage
```

### Aztec Contracts

Run all Aztec tests (Noir + JavaScript):

```bash
cd packages/aztec/aztec_gateway_7683
yarn test
```

Run only Noir tests:

```bash
yarn test:nr
```

Run only JavaScript integration tests:

```bash
yarn test:js
```

### Filler

Run filler unit tests:

```bash
cd packages/filler
yarn test
```

Run with coverage:

```bash
yarn test:coverage
```

Run in watch mode during development:

```bash
yarn test --watch
```

### SDK

The SDK includes tests for both Node.js and browser environments.

Run all tests:

```bash
cd packages/sdk
yarn test
```

Run Node.js tests only:

```bash
yarn test:node
```

Run browser tests only:

```bash
yarn test:browser
```

Run unit tests:

```bash
yarn test:unit
```

Run E2E tests:

```bash
yarn test:e2e
```

Generate coverage:

```bash
yarn test:coverage
```

## End-to-End Testing

E2E tests exercise the full bridge flow across Aztec and EVM chains.

### Prerequisites

Before running E2E tests:

1. **Deploy bridge contracts** - See [Deployment Guide](./deployment.md)
2. **Deploy test tokens** - `yarn deploy:tokens`
3. **Start the filler** - See [Filler Guide](./filler.md)
4. **Configure environment** - Set required variables

### Environment Variables

Create a `.env` file with:

```bash
# Aztec Configuration
AZTEC_SECRET_KEY=0x...          # Main deployer key
AZTEC_SALT=0x...                # Main deployer salt
AZTEC_RPC_URL=http://localhost:8080

# E2E Test Account
AZTEC_E2E_TEST_SECRET_KEY=0x... # Test account secret key
AZTEC_E2E_TEST_SALT=0x...       # Test account salt
AZTEC_E2E_TEST_ADDRESS=0x...    # Test account address

# Filler Account
AZTEC_FILLER_SECRET_KEY=0x...   # Filler secret key
AZTEC_FILLER_SALT=0x...         # Filler salt
AZTEC_FILLER_ADDRESS=0x...      # Filler address

# EVM Configuration
PRIVATE_KEY=0x...               # EVM deployer key
L2_RPC_URL=https://...          # Base Sepolia RPC

# EVM Test Accounts
EVM_E2E_TEST_PRIVATE_KEY=0x...  # EVM test account
EVM_E2E_TEST_ADDRESS=0x...      # EVM test address
EVM_FILLER_ADDRESS=0x...        # EVM filler address
```

### Running E2E Tests

Run full E2E test suite:

```bash
yarn test:bridge <deployment-json> <tokens-json>
```

Example:

```bash
yarn test:bridge \
  deployments/deploy_2026-01-28_12-00-00.json \
  deployments/tokens_deploy_2026-01-28_12-30-00.json
```

### What E2E Tests Cover

The E2E test script:

1. **Deploys test accounts** (if not already deployed)
2. **Ensures sufficient token balances** on both chains
3. **Tests Aztec → EVM flow**:
   - Opens a private order on Aztec
   - Waits for filler to detect and fill the order
   - Verifies tokens arrive on Base Sepolia
4. **Tests EVM → Aztec flow**:
   - Opens an order on Base Sepolia
   - Waits for filler to detect and fill
   - Verifies tokens arrive on Aztec

### Individual Flow Tests

You can also run individual flow tests from the Aztec package:

#### Base Sepolia → Aztec

```bash
cd packages/aztec/aztec_gateway_7683
node --loader ts-node/esm scripts/e2e/evm-to-aztec.ts \
  $AZTEC_SECRET_KEY \
  $AZTEC_SALT \
  $EVM_PRIVATE_KEY \
  $AZTEC_GATEWAY_ADDRESS \
  $L2_GATEWAY_ADDRESS \
  $L2_GATEWAY_DOMAIN \
  $AZTEC_TOKEN_ADDRESS \
  $L2_TOKEN_ADDRESS \
  $AZTEC_RECIPIENT_ADDRESS \
  $AZTEC_RPC_URL
```

#### Aztec → Base Sepolia

```bash
cd packages/aztec/aztec_gateway_7683
node --loader ts-node/esm scripts/e2e/aztec-to-evm.ts \
  $AZTEC_SECRET_KEY \
  $AZTEC_SALT \
  $AZTEC_GATEWAY_ADDRESS \
  $L2_GATEWAY_ADDRESS \
  $L2_GATEWAY_DOMAIN \
  $AZTEC_TOKEN_ADDRESS \
  $L2_TOKEN_ADDRESS \
  $EVM_RECIPIENT_ADDRESS \
  $AZTEC_RPC_URL
```

## Linting and Formatting

Run linting across all packages:

```bash
yarn lint
```

Fix lint errors:

```bash
yarn lint:fix
```

Format code:

```bash
yarn format
```

## Troubleshooting

### "Orders are not being filled"

- Ensure the filler is running and configured correctly
- Check filler logs for errors
- Verify contract addresses match between E2E config and filler config

### "Insufficient funds"

- Fund test accounts with ETH for gas
- Mint test tokens to test accounts

### "Connection refused to Aztec RPC"

- Start the Aztec sandbox: `aztec start sandbox`
- Or use the testnet URL in `AZTEC_RPC_URL`

### "Test timeout"

- Increase test timeout in Jest/Vitest config
- Check network connectivity
- Verify RPC endpoints are responsive

### Browser tests fail

- Ensure Playwright is installed: `npx playwright install`
- Check browser compatibility
- Try running with `--headed` flag for debugging
