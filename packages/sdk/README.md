# @substancelabs/aztec-evm-bridge-sdk

> ⚠️ **Disclaimer**
>
> This SDK is a **work in progress** and may undergo significant changes. Breaking changes may occur frequently.  
> Use it at your own risk in production environments. Contributions and feedback are welcome as the project evolves.

---

## 📦 Installation

```bash
npm install @substancelabs/aztec-evm-bridge-sdk
```

---

## 🚀 Quick Start

Here's a basic example showing how to initiate an order **from Aztec to Base**:

```ts
import { Bridge, aztecSepolia } from "@substancelabs/aztec-evm-bridge-sdk"
import { AzguardClient } from "@azguardwallet/client"
import { padHex } from "viem"
import { baseSepolia } from "viem/chains"

const azguardClient = new AzguardClient(/* your config */)

const bridge = await Bridge.create({
  azguardClient: azguardClient,
  evmProvider: wagmiClient,
})

const result = await bridge.openOrder(
  {
    chainIdIn: aztecSepolia.id,
    chainIdOut: baseSepolia.id,
    amountIn: 1000000n,
    amountOut: 990000n,
    tokenIn: "0x...",
    tokenOut: "0x...",
    recipient: padHex("0x123..."),
    mode: "public",
    data: padHex("0x"),
  },
  {
    onOrderOpened: ({ orderId, transactionHash }) => {
      console.log(`✅ Order ${orderId} opened: ${transactionHash}`)
    },
    onOrderFilled: ({ orderId, transactionHash }) => {
      console.log(`💰 Order ${orderId} filled: ${transactionHash}`)
    },
  }
)
```

**📚 For comprehensive documentation including API reference, order flows, examples, and troubleshooting, see [DOCUMENTATION.md](./DOCUMENTATION.md).**

---

## 🧪 Development

```bash
# Build the SDK
yarn build

# Run tests
yarn test

# Run tests with coverage
yarn test:coverage
```
