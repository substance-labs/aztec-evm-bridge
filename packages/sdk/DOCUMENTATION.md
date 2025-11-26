# Aztec-EVM Bridge SDK - Complete Documentation

## Table of Contents

1. [Introduction](#introduction)
2. [Installation](#installation)
3. [Quick Start](#quick-start)
4. [Core Concepts](#core-concepts)
5. [API Reference](#api-reference)
6. [Configuration](#configuration)
7. [Order Flows](#order-flows)
8. [Advanced Usage](#advanced-usage)
9. [Browser Integration](#browser-integration)
10. [Error Handling](#error-handling)
11. [Examples](#examples)
12. [Troubleshooting](#troubleshooting)

---

## Introduction

The Aztec-EVM Bridge SDK enables seamless cross-chain asset transfers between Aztec (a privacy-focused L2) and EVM-compatible chains using the ERC-7683 standard. This SDK provides a TypeScript interface for:

- **Opening Orders**: Initiate cross-chain swaps from Aztec to EVM or vice versa
- **Filling Orders**: Act as a filler to complete cross-chain orders
- **Claiming Orders**: Claim funds after an order is filled
- **Refunding Orders**: Refund orders that weren't filled before deadline
- **Forwarding Messages**: Forward cross-chain messages for settlement/refund

### Key Features

- ✅ **Privacy-First**: Supports both public and private transactions on Aztec
- ✅ **Type-Safe**: Full TypeScript support with comprehensive type definitions
- ✅ **Event Callbacks**: Real-time progress tracking with callback hooks
- ✅ **Flexible Wallet Support**: Works with direct private keys, Azguard wallet, or custom providers
- ✅ **Browser & Node**: Compatible with both browser and Node.js environments
- ✅ **ERC-7683 Compliant**: Implements the cross-chain intent standard

---

## Installation

```bash
npm install @substancelabs/aztec-evm-bridge-sdk viem
```

### Peer Dependencies

```json
{
  "viem": "^2.33.2",
  "@aztec/aztec.js": "3.0.0-devnet.2",
  "@aztec/foundation": "3.0.0-devnet.2"
}
```

---

## Quick Start

### Basic Example: Aztec → Base Sepolia

```typescript
import { Bridge, aztecSepolia } from "@substancelabs/aztec-evm-bridge-sdk"
import { baseSepolia } from "viem/chains"
import { padHex } from "viem"

// Initialize the bridge
const bridge = await Bridge.create({
  evmPrivateKey: "0x...",
  aztecWallet: myAztecWallet, // or use azguardClient
})

// Open an order
const result = await bridge.openOrder({
  chainIdIn: aztecSepolia.id,      // Source: Aztec
  chainIdOut: baseSepolia.id,       // Destination: Base Sepolia
  amountIn: 1000000n,               // 1 USDC (6 decimals)
  amountOut: 990000n,               // Min 0.99 USDC after slippage
  tokenIn: "0x...",                 // Aztec token address (32 bytes)
  tokenOut: "0x...",                // EVM token address (padded to 32 bytes)
  recipient: padHex("0xYourAddress"), // Recipient address (32 bytes)
  mode: "private",                  // Transaction privacy mode
  data: padHex("0x"),              // Additional data (32 bytes)
})

console.log("Order ID:", result.resolvedOrder.orderId)
console.log("TX Hash:", result.orderOpenedTxHash)
```

---

## Core Concepts

### Bridge Instance

The `Bridge` class is the main entry point. It must be created using the async factory pattern:

```typescript
// ✅ Correct: Use async factory
const bridge = await Bridge.create(configs)

// ❌ Incorrect: Direct instantiation not supported
// const bridge = new Bridge(configs) // This won't work
```

### Order Lifecycle

```
┌─────────────┐
│   OPENED    │ ← User creates order on source chain
└──────┬──────┘
       │
       ↓
┌─────────────┐
│   FILLED    │ ← Filler provides liquidity on destination chain
└──────┬──────┘
       │
       ↓
┌─────────────┐
│   CLAIMED   │ ← User claims funds (private orders only)
└─────────────┘
```

### Transaction Modes

| Mode | Description | Use Case |
|------|-------------|----------|
| `private` | Funds move from private balance | Maximum privacy |
| `public` | Funds move from public balance | Transparent transfers |
| `privateWithHook` | Private + callback contract | DeFi integrations |
| `publicWithHook` | Public + callback contract | DeFi integrations |

### Chain IDs

```typescript
import { aztecSepolia } from "@substancelabs/aztec-evm-bridge-sdk"
import { baseSepolia, sepolia } from "viem/chains"

// Aztec Sepolia
aztecSepolia.id // 999999

// Supported EVM chains
baseSepolia.id  // 84532
sepolia.id      // 11155111
```

---

## API Reference

### Bridge.create()

Create a new Bridge instance (async factory pattern).

```typescript
static async create(configs: BridgeConfigs): Promise<Bridge>
```

**Parameters:**

```typescript
interface BridgeConfigs {
  // Aztec wallet options (choose one)
  aztecWallet?: Wallet              // Direct Aztec wallet instance
  azguardClient?: AzguardClient     // Azguard wallet client

  // EVM wallet options (choose one)
  evmPrivateKey?: Hex               // Private key (0x-prefixed)
  evmProvider?: any                 // Wagmi/ethers provider

  // Optional
  beaconApiUrl?: string             // For forward operations
}
```

**Example:**

```typescript
// Option 1: With Aztec wallet + EVM private key
const bridge = await Bridge.create({
  aztecWallet: myWallet,
  evmPrivateKey: "0x...",
})

// Option 2: With Azguard wallet
const bridge = await Bridge.create({
  azguardClient: azguardClient,
  evmPrivateKey: "0x...",
})

// Option 3: With EVM provider (browser)
const bridge = await Bridge.create({
  aztecWallet: myWallet,
  evmProvider: wagmiClient,
})
```

---

### openOrder()

Open a new cross-chain order.

```typescript
async openOrder(
  order: Order,
  callbacks?: OrderCallbacks
): Promise<OrderResult>
```

**Parameters:**

```typescript
interface Order {
  chainIdIn: number          // Source chain ID
  chainIdOut: number         // Destination chain ID
  amountIn: bigint          // Amount to send
  amountOut: bigint         // Minimum amount to receive
  tokenIn: Hex              // Source token address (32 bytes)
  tokenOut: Hex             // Destination token address (32 bytes)
  recipient: Hex            // Recipient address (32 bytes)
  mode: SwapMode            // "private" | "public" | "privateWithHook" | "publicWithHook"
  data: Hex                 // Additional data (32 bytes)
  fillDeadline?: number     // Unix timestamp (default: 2^32 - 1)
}

interface OrderCallbacks {
  onSecret?: (params: { orderId: Hex; secret: Hex }) => void
  onOrderOpened?: (params: { orderId: Hex; resolvedOrder: ResolvedOrder; transactionHash: Hex }) => void
  onOrderFilled?: (params: { orderId: Hex; transactionHash?: Hex }) => void
  onOrderClaimed?: (params: { orderId: Hex; transactionHash: Hex }) => void
}
```

**Returns:**

```typescript
interface OrderResult {
  orderOpenedTxHash: Hex
  orderFilledTxHash?: Hex
  orderClaimedTxHash?: Hex
  resolvedOrder: ResolvedOrder
}
```

**Example:**

```typescript
const result = await bridge.openOrder(
  {
    chainIdIn: aztecSepolia.id,
    chainIdOut: baseSepolia.id,
    amountIn: 1000000n,
    amountOut: 990000n,
    tokenIn: "0x...",
    tokenOut: "0x...",
    recipient: padHex("0x123..."),
    mode: "private",
    data: padHex("0x"),
  },
  {
    onSecret: ({ orderId, secret }) => {
      console.log(`🔐 Secret for order ${orderId}: ${secret}`)
      // IMPORTANT: Save this secret for private orders!
    },
    onOrderOpened: ({ orderId, transactionHash }) => {
      console.log(`✅ Order ${orderId} opened: ${transactionHash}`)
    },
    onOrderFilled: ({ orderId, transactionHash }) => {
      console.log(`💰 Order ${orderId} filled: ${transactionHash}`)
    },
    onOrderClaimed: ({ orderId, transactionHash }) => {
      console.log(`🎉 Order ${orderId} claimed: ${transactionHash}`)
    },
  }
)
```

**Parameters:**

```typescript
interface FillOrderDetails {
  orderId: Hex
  orderData: OrderData
}

interface OrderData {
  sender: Hex
  recipient: Hex
  inputToken: Hex
  outputToken: Hex
  amountIn: bigint
  amountOut: bigint
  senderNonce: bigint
  originDomain: number
  destinationDomain: number
  destinationSettler: Hex
  fillDeadline: number
  orderType: number
  data: Hex
}
```

**Returns:** Transaction hash (Hex)

**Example:**

```typescript
// Get order data from event logs or API
const orderData = await fetchOrderData(orderId)

const txHash = await bridge.fillOrder({
  orderId,
  orderData,
})

console.log("Order filled:", txHash)
```


---

### refundOrder()

Refund an expired or unfilled order.

```typescript
async refundOrder(details: RefundOrderDetails): Promise<Hex>
```

**Parameters:**

```typescript
interface RefundOrderDetails {
  orderId: Hex
  chainIdIn: number
  chainIdOut: number
  chainIdForwarder?: number
}
```

**Example:**

```typescript
const txHash = await bridge.refundOrder({
  orderId: "0x...",
  chainIdIn: aztecSepolia.id,
  chainIdOut: baseSepolia.id,
})
```

## Order Flows

### Flow 1: Aztec → EVM (Private)

```typescript
// 1. User opens order on Aztec
const result = await bridge.openOrder({
  chainIdIn: aztecSepolia.id,
  chainIdOut: baseSepolia.id,
  amountIn: 1000000n,
  amountOut: 990000n,
  tokenIn: aztecToken,
  tokenOut: padHex(evmToken),
  recipient: padHex(userAddress),
  mode: "private",
  data: padHex("0x"),
}, {
  onSecret: ({ secret }) => {
    // Store secret locally - needed for later!
    localStorage.setItem('order_secret', secret)
  }
})

// 2. Filler fills the order on Base Sepolia
// (This happens externally by a filler service)

// 3. SDK automatically monitors and processes
// Order is complete when onOrderFilled callback fires
```

### Flow 2: Aztec → EVM (Public)

```typescript
// 1. User opens order on Aztec
const result = await bridge.openOrder({
  chainIdIn: aztecSepolia.id,
  chainIdOut: baseSepolia.id,
  amountIn: 1000000n,
  amountOut: 990000n,
  tokenIn: aztecToken,
  tokenOut: padHex(evmToken),
  recipient: padHex(userAddress),
  mode: "public",  // Public mode - no secret needed
  data: padHex("0x"),
}, {
  onOrderOpened: ({ orderId, transactionHash }) => {
    console.log('Order opened publicly:', orderId)
  },
  onOrderFilled: ({ orderId, transactionHash }) => {
    console.log('Order filled:', orderId)
    // Funds automatically transferred on fill - no claim needed
  }
})

// 2. Filler fills the order on Base Sepolia
// 3. Order is complete - funds transferred to recipient automatically
```

### Flow 3: EVM → Aztec (Private)

```typescript
// 1. User opens order on Base Sepolia
const result = await bridge.openOrder({
  chainIdIn: baseSepolia.id,
  chainIdOut: aztecSepolia.id,
  amountIn: 1000000n,
  amountOut: 990000n,
  tokenIn: padHex(evmToken),
  tokenOut: aztecToken,
  recipient: padHex(aztecAddress),
  mode: "private",
  data: padHex("0x"),
}, {
  onSecret: ({ orderId, secret }) => {
    console.log('Save this secret:', secret)
    // SDK automatically uses this secret to claim when order is filled
  },
  onOrderFilled: ({ orderId }) => {
    console.log('Order filled! Claiming automatically...')
  },
  onOrderClaimed: ({ orderId, transactionHash }) => {
    console.log('Order claimed!', transactionHash)
  }
})

// 2. Filler fills on Aztec (external filler service)
// 3. SDK automatically monitors and claims with the secret
// Order is complete when onOrderClaimed callback fires
```

### Flow 4: EVM → Aztec (Public)

```typescript
// 1. User opens order on Base Sepolia
const result = await bridge.openOrder({
  chainIdIn: baseSepolia.id,
  chainIdOut: aztecSepolia.id,
  amountIn: 1000000n,
  amountOut: 990000n,
  tokenIn: padHex(evmToken),
  tokenOut: aztecToken,
  recipient: padHex(aztecAddress),
  mode: "public",  // Public mode - transparent transfer
  data: padHex("0x"),
}, {
  onOrderOpened: ({ orderId, transactionHash }) => {
    console.log('Order opened on EVM:', transactionHash)
  },
  onOrderFilled: ({ orderId }) => {
    console.log('Order filled on Aztec!')
    // Funds transferred to public balance automatically
  }
})

// 2. Filler fills on Aztec (external filler service)
// 3. Funds appear in recipient's public balance on Aztec
// Order is complete when onOrderFilled callback fires
```

---

## Advanced Usage

### Custom Token Addresses

```typescript
import { padHex } from "viem"

// EVM token (20 bytes) -> Pad to 32 bytes
const evmToken = "0xAf31a5CFf95131B2E0D3fa89125342984567f399"
const paddedEvmToken = padHex(evmToken) // 0x000000000000000000000000Af31a5CFf95131B2E0D3fa89125342984567f399

// Aztec token (already 32 bytes)
const aztecToken = "0x089d76aaa3261376f2073894cddff9a070c1ca2c3ae2a2b25fcce25d68caae81"
```

### Custom Deadlines

```typescript
// Order expires in 1 hour
const oneHourFromNow = Math.floor(Date.now() / 1000) + 3600

const result = await bridge.openOrder({
  // ... other params
  fillDeadline: oneHourFromNow,
})
```

### Batch Operations

```typescript
// Open multiple orders
const orders = [
  { chainIdIn: aztecSepolia.id, chainIdOut: baseSepolia.id, /* ... */ },
  { chainIdIn: aztecSepolia.id, chainIdOut: sepolia.id, /* ... */ },
]

const results = await Promise.all(
  orders.map(order => bridge.openOrder(order))
)
```

### Using with Existing Aztec Wallet

```typescript
import { createPXEClient, Wallet } from "@aztec/aztec.js"
import { AccountManager } from "@aztec/accounts/schnorr"

// Create PXE client
const pxe = createPXEClient("https://devnet.aztec-labs.com")

// Create account manager
const accountManager = AccountManager.fromSecretKeyAndSalt(secretKey, salt, pxe)
const wallet = await Wallet.fromAccountManager(accountManager)

// Use with Bridge
const bridge = await Bridge.create({
  aztecWallet: wallet,
  evmPrivateKey: "0x...",
})
```

---

## Browser Integration

### React + Wagmi Example

```typescript
import { Bridge, aztecSepolia } from "@substancelabs/aztec-evm-bridge-sdk"
import { useWalletClient } from "wagmi"
import { baseSepolia } from "viem/chains"
import { useState } from "react"

function BridgeComponent() {
  const { data: walletClient } = useWalletClient()
  const [status, setStatus] = useState("")

  async function handleBridge() {
    if (!walletClient) return

    const bridge = await Bridge.create({
      evmProvider: walletClient,
      aztecWallet: myAztecWallet, // You need to provide this
    })

    setStatus("Opening order...")

    const result = await bridge.openOrder(
      {
        chainIdIn: baseSepolia.id,
        chainIdOut: aztecSepolia.id,
        amountIn: 1000000n,
        amountOut: 990000n,
        // ... other params
      },
      {
        onOrderOpened: () => setStatus("Order opened!"),
        onOrderFilled: () => setStatus("Order filled!"),
        onOrderClaimed: () => setStatus("Complete!"),
      }
    )
  }

  return (
    <button onClick={handleBridge}>
      Bridge to Aztec
    </button>
  )
}
```

### Required Polyfills (Vite)

```typescript
// vite.config.ts
import { defineConfig } from "vite"
import { nodePolyfills } from "vite-plugin-node-polyfills"
import wasm from "vite-plugin-wasm"
import topLevelAwait from "vite-plugin-top-level-await"

export default defineConfig({
  plugins: [
    wasm(),
    topLevelAwait(),
    nodePolyfills({
      include: ["buffer", "crypto", "util", "process", "stream"],
      globals: { Buffer: true, process: true },
    }),
  ],
  define: {
    global: "globalThis",
  },
  server: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
})
```

---

## Error Handling

### Common Errors

```typescript
try {
  await bridge.openOrder(order)
} catch (error) {
  if (error.message.includes("Invalid chains")) {
    // Source and destination are the same
  } else if (error.message.includes("Order expired")) {
    // Fill deadline passed
  } else if (error.message.includes("Insufficient allowance")) {
    // Need to approve tokens first
  } else if (error.message.includes("No contract instance found")) {
    // Contract not registered
  } else {
    // Other error
    console.error("Bridge error:", error)
  }
}
```

### Error Types

| Error Message | Cause | Solution |
|---------------|-------|----------|
| `Invalid chains: source and destination must differ` | Same chain for in/out | Use different chains |
| `Invalid mode: ${mode}` | Invalid transaction mode | Use valid mode |
| `Invalid data: must be 32 bytes` | Data not 32 bytes | Use padHex() |
| `Order expired` | Past fill deadline | Check deadline |
| `Neither chain is Aztec` | Both chains are EVM | One must be Aztec |
| `You must specify aztecWallet or azguardClient` | No Aztec wallet | Provide wallet |
| `Cannot specify both evmPrivateKey and evmProvider` | Both EVM options provided | Choose one |

---

## Examples

### Example 1: Simple Bridge Transfer

```typescript
import { Bridge, aztecSepolia } from "@substancelabs/aztec-evm-bridge-sdk"
import { baseSepolia } from "viem/chains"
import { padHex } from "viem"

async function simpleTransfer() {
  const bridge = await Bridge.create({
    aztecWallet: myWallet,
    evmPrivateKey: process.env.EVM_PRIVATE_KEY,
  })

  const result = await bridge.openOrder({
    chainIdIn: aztecSepolia.id,
    chainIdOut: baseSepolia.id,
    amountIn: 1_000_000n, // 1 USDC
    amountOut: 990_000n,  // Accept 1% slippage
    tokenIn: "0x...",
    tokenOut: padHex("0x..."),
    recipient: padHex("0x..."),
    mode: "private",
    data: padHex("0x"),
  })

  console.log("Success! Order ID:", result.resolvedOrder.orderId)
}
```

### Example 2: With Progress Tracking

```typescript
import { Bridge } from "@substancelabs/aztec-evm-bridge-sdk"

async function trackedTransfer() {
  const bridge = await Bridge.create({ /* ... */ })

  let secret: string

  await bridge.openOrder(
    {
      /* order params */
    },
    {
      onSecret: ({ orderId, secret: s }) => {
        secret = s
        console.log(`🔐 Secret generated: ${s}`)
        // CRITICAL: Save secret for private orders!
        saveSecretSecurely(orderId, s)
      },
      onOrderOpened: ({ orderId, transactionHash }) => {
        console.log(`✅ Order opened: ${orderId}`)
        console.log(`   TX: ${transactionHash}`)
        updateUI({ status: "opened", txHash: transactionHash })
      },
      onOrderFilled: ({ orderId, transactionHash }) => {
        console.log(`💰 Order filled: ${orderId}`)
        if (transactionHash) {
          console.log(`   TX: ${transactionHash}`)
        }
        updateUI({ status: "filled" })
      },
      onOrderClaimed: ({ orderId, transactionHash }) => {
        console.log(`🎉 Order claimed: ${orderId}`)
        console.log(`   TX: ${transactionHash}`)
        updateUI({ status: "complete" })
      },
    }
  )
}
```

---

## Troubleshooting

### Issue: "Cannot find module '@aztec/aztec.js'"

**Solution:** Install peer dependencies:
```bash
npm install @aztec/aztec.js@3.0.0-devnet.2 @aztec/foundation@3.0.0-devnet.2
```

### Issue: "Failed to fetch" in browser

**Solution:** Add CORS headers to your Vite config:
```typescript
server: {
  headers: {
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Embedder-Policy": "require-corp",
  },
}
```

### Issue: "Buffer is not defined"

**Solution:** Add buffer polyfill:
```bash
npm install vite-plugin-node-polyfills
```

### Issue: Order stuck at "opened" status

**Possible causes:**
1. No filler available for this order pair
2. Order not profitable enough for fillers
3. Fill deadline too short

**Solution:** Check order parameters.

### Issue: "No contract instance found"

**Solution:** The SDK automatically registers contracts. If this persists, ensure:
1. You're using `Bridge.create()` (not `new Bridge()`)
2. Aztec node URL is correct
3. Network connection is stable

### Issue: Transaction reverted

**Common causes:**
- Insufficient token balance
- Missing token approvals
- Order already filled/expired
- Invalid recipient address

**Debug:**
```typescript
try {
  await bridge.openOrder(order)
} catch (error) {
  console.error("Error details:", error)
  // Check token balance
  // Check token allowance
  // Verify order parameters
}
```

---

## Additional Resources

- **ERC-7683 Specification**: [eips.ethereum.org/EIPS/eip-7683](https://eips.ethereum.org/EIPS/eip-7683)
- **Aztec Documentation**: [docs.aztec.network](https://docs.aztec.network)
- **GitHub Repository**: [github.com/substance-labs/aztec-evm-bridge](https://github.com/substance-labs/aztec-evm-bridge)

---

## Contributing

We welcome contributions! See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

---

## License

MIT License - see [LICENSE](./LICENSE) file for details.
