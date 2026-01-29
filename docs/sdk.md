# SDK Guide

The `@substancelabs/aztec-evm-bridge-sdk` provides a TypeScript interface for bridging assets between Aztec and EVM chains using the ERC-7683 standard.

## Installation

```bash
npm install @substancelabs/aztec-evm-bridge-sdk viem
```

or

```bash
yarn add @substancelabs/aztec-evm-bridge-sdk viem
```

## Quick Start

### Aztec → Base Sepolia

```typescript
import { Bridge, aztecSepolia } from "@substancelabs/aztec-evm-bridge-sdk"
import { baseSepolia } from "viem/chains"
import { padHex } from "viem"

// Initialize the bridge
const bridge = await Bridge.create({
  aztecWallet: myAztecWallet,
  evmPrivateKey: "0x...",
})

// Open an order
const result = await bridge.openOrder({
  chainIdIn: aztecSepolia.id,      // Source: Aztec
  chainIdOut: baseSepolia.id,       // Destination: Base Sepolia
  amountIn: 1000000n,               // Amount to send
  amountOut: 990000n,               // Minimum to receive (after fees)
  tokenIn: "0x...",                 // Aztec token address
  tokenOut: "0x...",                // EVM token address
  recipient: padHex("0x..."),       // Recipient address
  mode: "private",                  // Transaction mode
  data: padHex("0x"),               // Additional data
})

console.log("Order ID:", result.resolvedOrder.orderId)
```

### Base Sepolia → Aztec

```typescript
const result = await bridge.openOrder({
  chainIdIn: baseSepolia.id,        // Source: Base Sepolia
  chainIdOut: aztecSepolia.id,      // Destination: Aztec
  amountIn: 1000000n,
  amountOut: 990000n,
  tokenIn: "0x...",
  tokenOut: "0x...",
  recipient: padHex("0x..."),
  mode: "public",
  data: padHex("0x"),
})
```

## Bridge Initialization

The Bridge must be created using the async factory pattern:

```typescript
// ✅ Correct
const bridge = await Bridge.create(configs)

// ❌ Incorrect - constructor is not public
const bridge = new Bridge(configs)
```

### Configuration Options

```typescript
interface BridgeConfigs {
  // Aztec wallet (choose one)
  aztecWallet?: Wallet              // Direct Aztec wallet instance
  azguardClient?: AzguardClient     // Azguard wallet client

  // EVM wallet (choose one)
  evmPrivateKey?: Hex               // Private key (0x-prefixed)
  evmProvider?: any                 // Wagmi/ethers provider

  // Optional
  beaconApiUrl?: string             // For forward operations
}
```

### Examples

**With Aztec wallet + EVM private key:**

```typescript
const bridge = await Bridge.create({
  aztecWallet: myWallet,
  evmPrivateKey: "0xabc...",
})
```

**With Azguard wallet client:**

```typescript
import { AzguardClient } from "@azguardwallet/client"

const azguardClient = new AzguardClient(/* config */)

const bridge = await Bridge.create({
  azguardClient: azguardClient,
  evmPrivateKey: "0xabc...",
})
```

**With browser wallet (wagmi):**

```typescript
const bridge = await Bridge.create({
  aztecWallet: myWallet,
  evmProvider: wagmiClient,
})
```

## Order Lifecycle

Orders progress through these states:

```
OPENED → FILLED → CLAIMED (private orders only)
```

1. **OPENED**: User creates order on source chain
2. **FILLED**: Filler provides liquidity on destination chain
3. **CLAIMED**: User claims funds (only for private Aztec orders)

## Transaction Modes

| Mode | Description | Use Case |
| ---- | ----------- | -------- |
| `private` | Funds from private Aztec balance | Maximum privacy |
| `public` | Funds from public Aztec balance | Transparent transfers |
| `privateWithHook` | Private + callback contract | DeFi integrations |
| `publicWithHook` | Public + callback contract | DeFi integrations |

## API Reference

### Bridge.create()

Creates a new Bridge instance.

```typescript
static async create(configs: BridgeConfigs): Promise<Bridge>
```

### bridge.openOrder()

Opens a cross-chain order.

```typescript
async openOrder(
  params: OpenOrderParams,
  callbacks?: OrderCallbacks
): Promise<OpenOrderResult>
```

**Parameters:**

```typescript
interface OpenOrderParams {
  chainIdIn: number          // Source chain ID
  chainIdOut: number         // Destination chain ID
  amountIn: bigint           // Amount to send
  amountOut: bigint          // Minimum to receive
  tokenIn: Hex               // Source token (32 bytes)
  tokenOut: Hex              // Destination token (32 bytes)
  recipient: Hex             // Recipient address (32 bytes)
  mode: TransactionMode      // 'private' | 'public' | etc.
  data: Hex                  // Additional data (32 bytes)
}
```

**Callbacks:**

```typescript
interface OrderCallbacks {
  onOrderOpened?: (data: { orderId: string; transactionHash: string }) => void
  onOrderFilled?: (data: { orderId: string; transactionHash: string }) => void
  onOrderClaimed?: (data: { orderId: string; transactionHash: string }) => void
  onError?: (error: Error) => void
}
```

**Returns:**

```typescript
interface OpenOrderResult {
  resolvedOrder: {
    orderId: string
    // ... order details
  }
  orderOpenedTxHash: string
}
```

### bridge.claimOrder()

Claims funds from a filled private order (Aztec orders only).

```typescript
async claimOrder(orderId: string): Promise<ClaimResult>
```

### bridge.refundOrder()

Refunds an unfilled order after deadline.

```typescript
async refundOrder(orderId: string): Promise<RefundResult>
```

### bridge.getOrderStatus()

Gets the current status of an order.

```typescript
async getOrderStatus(orderId: string): Promise<OrderStatus>
```

## Chain IDs

```typescript
import { aztecSepolia } from "@substancelabs/aztec-evm-bridge-sdk"
import { baseSepolia, sepolia } from "viem/chains"

// Aztec Sepolia
aztecSepolia.id  // 999999

// Base Sepolia
baseSepolia.id   // 84532

// Ethereum Sepolia
sepolia.id       // 11155111
```

## Address Formatting

All addresses must be 32 bytes (64 hex characters + 0x prefix). Use `padHex` from viem:

```typescript
import { padHex } from "viem"

// Pad a 20-byte EVM address to 32 bytes
const recipient = padHex("0x1234567890123456789012345678901234567890")
// Result: 0x0000000000000000000000001234567890123456789012345678901234567890
```

## Error Handling

```typescript
try {
  const result = await bridge.openOrder(params)
} catch (error) {
  if (error.message.includes("insufficient balance")) {
    console.error("Not enough tokens")
  } else if (error.message.includes("deadline")) {
    console.error("Order deadline has passed")
  } else {
    console.error("Unknown error:", error)
  }
}
```

Or use callbacks:

```typescript
await bridge.openOrder(params, {
  onError: (error) => {
    console.error("Order failed:", error.message)
  }
})
```

## Browser Integration

The SDK works in both Node.js and browser environments.

### Browser Requirements

- Modern browser with Web Crypto API support
- IndexedDB for Aztec wallet storage
- WASM support

### Vite Configuration

For Vite projects, add these polyfills:

```typescript
// vite.config.ts
import { defineConfig } from 'vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import wasm from 'vite-plugin-wasm'
import topLevelAwait from 'vite-plugin-top-level-await'

export default defineConfig({
  plugins: [
    wasm(),
    topLevelAwait(),
    nodePolyfills({
      include: ['buffer', 'crypto', 'stream', 'util']
    })
  ]
})
```

## Development

### Building

```bash
cd packages/sdk
yarn build
```

### Testing

```bash
# All tests
yarn test

# Node.js tests
yarn test:node

# Browser tests
yarn test:browser

# With coverage
yarn test:coverage
```

### Watch Mode

```bash
yarn test:watch
```

## Examples

### Complete Flow with Callbacks

```typescript
import { Bridge, aztecSepolia } from "@substancelabs/aztec-evm-bridge-sdk"
import { baseSepolia } from "viem/chains"
import { padHex } from "viem"

async function bridgeTokens() {
  const bridge = await Bridge.create({
    aztecWallet: myWallet,
    evmPrivateKey: process.env.EVM_PRIVATE_KEY as `0x${string}`,
  })

  const result = await bridge.openOrder(
    {
      chainIdIn: aztecSepolia.id,
      chainIdOut: baseSepolia.id,
      amountIn: 1000000n,
      amountOut: 990000n,
      tokenIn: process.env.AZTEC_TOKEN as `0x${string}`,
      tokenOut: padHex(process.env.EVM_TOKEN as `0x${string}`),
      recipient: padHex(process.env.RECIPIENT as `0x${string}`),
      mode: "private",
      data: padHex("0x"),
    },
    {
      onOrderOpened: ({ orderId, transactionHash }) => {
        console.log(`✅ Order ${orderId} opened`)
        console.log(`   TX: ${transactionHash}`)
      },
      onOrderFilled: ({ orderId, transactionHash }) => {
        console.log(`💰 Order ${orderId} filled`)
        console.log(`   TX: ${transactionHash}`)
      },
      onError: (error) => {
        console.error(`❌ Error: ${error.message}`)
      },
    }
  )

  console.log("Order complete:", result.resolvedOrder.orderId)
}
```

### React Hook Example

```typescript
import { useState, useCallback } from 'react'
import { Bridge, aztecSepolia } from "@substancelabs/aztec-evm-bridge-sdk"

function useBridge(wallet, evmPrivateKey) {
  const [bridge, setBridge] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const initBridge = useCallback(async () => {
    setLoading(true)
    try {
      const b = await Bridge.create({
        aztecWallet: wallet,
        evmPrivateKey,
      })
      setBridge(b)
    } catch (e) {
      setError(e)
    } finally {
      setLoading(false)
    }
  }, [wallet, evmPrivateKey])

  return { bridge, loading, error, initBridge }
}
```

## Troubleshooting

### "Bridge.create failed"

- Ensure wallet credentials are correct
- Verify RPC endpoints are accessible
- Check that required dependencies are installed

### "Order not being filled"

- Ensure a filler is running and monitoring the gateway
- Verify token addresses are correct
- Check that amountOut is reasonable (not higher than amountIn)

### "Transaction reverted"

- Verify sufficient token balance
- Check token approvals
- Ensure order deadline hasn't passed

### Browser WASM errors

- Ensure `vite-plugin-wasm` is configured
- Check that `topLevelAwait` plugin is enabled
- Verify browser supports required APIs
