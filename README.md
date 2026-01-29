# 🔐 Aztec-EVM Bridge

A privacy-preserving, trust-minimized cross-chain intent execution framework for secure transactions between the [Aztec Network](https://aztec.network/) and EVM-compatible L2 chains.

## Overview

The **Aztec-EVM Bridge** enables confidential cross-chain bridging between Aztec and EVM L2 solutions like **Base**. It implements the ERC-7683 intent standard with a filler-based model for trust-minimized execution.

📚 **Full documentation**: [https://substance-labs.gitbook.io/aztec-evm-bridge/](https://substance-labs.gitbook.io/aztec-evm-bridge/)

## ⚠️ Disclaimer

This project is a **proof of concept** for research and experimentation purposes only. We have **not evaluated compliance** with applicable laws or regulations. **Not deployed to mainnet**. Use at your own risk.

## Features

- **🕵️ Privacy-Preserving Transactions**: Utilizes Aztec's zero-knowledge proofs to ensure transaction confidentiality.
- **🛡️ Trust-Minimized Execution**: Implements a filler-based model where fillers fulfill intents and execute cross-chain transactions without centralized intermediaries.
- **🌐 Cross-Chain Interoperability**: Designed to be compatible with any EVM L2 that settles on Ethereum, facilitating broad adoption.
- **🎛️ Support for Public and Private Intents**: Accommodates both public and private transaction intents, enhancing flexibility and user control.

## Quick Start

### Prerequisites

- Node.js v20+
- Yarn v4+
- Foundry (for EVM contracts)
- Aztec CLI (for Aztec contracts)

### Installation

```bash
git clone https://github.com/substance-labs/aztec-evm-bridge.git
cd aztec-evm-bridge
yarn install
```

### Build

```bash
yarn build
```

### Deploy

```bash
# Deploy bridge contracts
yarn deploy:bridge

# Deploy test tokens
yarn deploy:tokens
```

### Run E2E Tests

```bash
yarn test:bridge <deployment-json> <tokens-json>
```

## Documentation

| Guide | Description |
| ----- | ----------- |
| [Deployment](docs/deployment.md) | Deploy bridge contracts and test tokens |
| [Testing](docs/testing.md) | Unit testing and E2E testing guide |
| [Filler](docs/filler.md) | Configure and run the filler service |
| [SDK](docs/sdk.md) | Use the SDK in your application |
| [Releasing](docs/releasing.md) | Version management and publishing |

## Packages

| Package | Description |
| ------- | ----------- |
| [`packages/sdk`](packages/sdk) | TypeScript SDK for bridge integration |
| [`packages/filler`](packages/filler) | Order filling service |
| [`packages/evm`](packages/evm) | Solidity contracts (L2Gateway, Forwarder) |
| [`packages/aztec/aztec_gateway_7683`](packages/aztec/aztec_gateway_7683) | Aztec Noir contracts |
| [`packages/deploy`](packages/deploy) | Deployment scripts |
| [`packages/e2e`](packages/e2e) | End-to-end tests |
| [`packages/bridge-app`](packages/bridge-app) | Demo web application |

## 🧠 Architecture

The framework leverages **ERC-7683 intents** and includes a **Forwarder contract** on Ethereum to ensure verifiable cross-chain settlement. The filler-based model operates as follows:

### 🔒 Private Intents

- **EVM → Aztec**:  
  A user expresses an intent on the EVM L2 by locking assets into an ERC-7683-compatible contract. A filler monitors for such intents and mirrors the value inside the Aztec Gateway by locking their own funds. The user then privately claims these funds within Aztec using a secret.
  This private claim triggers a message through Aztec’s native bridge. The message is consumed by the Forwarder contract on Ethereum, which writes a verifiable commitment to storage confirming the successful claim. This commitment enables the filler to retrieve their initially locked funds on the EVM L2 by submitting a storage proof via the settle function.

- **Aztec → EVM**:  
  A user initiates a private transfer inside Aztec, expressing the intent to send assets to an EVM L2. A filler observes this intent and pre-funds the user on the destination EVM L2 chain by advancing their own capital. 
  At this point, for the filler to reclaim their funds (i.e., trigger settlement), they must wait until the new EVM L2 anchor root is published on Ethereum mainnet. This root will be used to verify that the filling occurred correctly. Once verified, the Forwarder contract verifies the fill via a storage proof and sends a message to Aztec via the native bridge, initiating the settlement process and enabling the filler to retrieve their funds.


> 💡 **Public intents follow a similar flow, with two key differences:**  
>  
> ✅ Transfers are **public**, meaning the intent and fulfillment are visible on-chain.  
> ✅ On Aztec, the user does **not** need to manually claim the funds — they are transferred automatically during the filling process.  
>  
> 🔁 Settlement remains unchanged

## Scripts

| Command | Description |
| ------- | ----------- |
| `yarn build` | Build all packages |
| `yarn deploy:bridge` | Deploy bridge infrastructure |
| `yarn deploy:tokens` | Deploy test tokens |
| `yarn test:bridge` | Run E2E bridge tests |
| `yarn lint` | Lint all packages |
| `yarn format` | Format code |

## Development

### Linting

```bash
yarn lint
yarn lint:fix
```

### Testing

```bash
# EVM contract tests
cd packages/evm && forge test

# Filler tests
cd packages/filler && yarn test

# SDK tests
cd packages/sdk && yarn test
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make changes with tests
4. Create a changeset: `yarn changeset`
5. Submit a pull request

## License

MIT License - see [LICENSE](LICENSE) for details.
