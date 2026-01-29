# @substancelabs/aztec-evm-bridge-sdk

TypeScript SDK for bridging assets between Aztec and EVM chains using ERC-7683.

## Installation

```bash
npm install @substancelabs/aztec-evm-bridge-sdk viem
```

## Quick Start

```typescript
import { Bridge, aztecSepolia } from "@substancelabs/aztec-evm-bridge-sdk"
import { baseSepolia } from "viem/chains"
import { padHex } from "viem"

const bridge = await Bridge.create({
  aztecWallet: myWallet,
  evmPrivateKey: "0x...",
})

const result = await bridge.openOrder({
  chainIdIn: aztecSepolia.id,
  chainIdOut: baseSepolia.id,
  amountIn: 1000000n,
  amountOut: 990000n,
  tokenIn: "0x...",
  tokenOut: "0x...",
  recipient: padHex("0x..."),
  mode: "private",
  data: padHex("0x"),
})
```

## Scripts

| Command | Description |
| ------- | ----------- |
| `yarn build` | Build the SDK |
| `yarn test` | Run all tests |
| `yarn test:node` | Run Node.js tests |
| `yarn test:browser` | Run browser tests |
| `yarn test:e2e` | Run E2E tests (requires filler running) |
| `yarn test:browser:e2e` | Run browser E2E tests (requires filler running) |
| `yarn test:coverage` | Run with coverage |

## E2E Tests

E2E tests require the filler service to be running. See the [Filler Guide](../../docs/filler.md) for setup instructions.

```bash
# Start the filler first
cd packages/filler
docker compose up -d

# Then run SDK E2E tests
cd packages/sdk
yarn test:e2e
```

## Features

- ✅ Privacy-first transactions
- ✅ Full TypeScript support
- ✅ Event callbacks for progress tracking
- ✅ Browser and Node.js compatible
- ✅ ERC-7683 compliant

## Documentation

- [SDK Guide](../../docs/sdk.md) - Full API reference and examples
- [Testing Guide](../../docs/testing.md)
