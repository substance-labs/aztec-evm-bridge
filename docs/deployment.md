# Deployment Guide

This guide covers deploying the Aztec-EVM Bridge infrastructure and test tokens.

## Prerequisites

Before deploying, ensure you have:

- **Node.js** (v20+) and **Yarn** (v4+) installed
- **Foundry** (for EVM contract compilation and deployment)
- **Aztec CLI** (`aztec` for Aztec contract compilation)
- Funded wallets on:
  - Ethereum Sepolia (for Forwarder deployment)
  - Base Sepolia (for L2Gateway deployment)
  - Aztec Testnet (for AztecGateway deployment)

## Environment Setup

Create a `.env` file in the repository root with the following variables:

### Required for Bridge Deployment

| Variable                   | Description                                      |
| -------------------------- | ------------------------------------------------ |
| `PRIVATE_KEY`              | EVM deployer private key (hex with 0x prefix)    |
| `PERMIT2`                  | Permit2 contract address on Base Sepolia         |
| `AZTEC_INBOX`              | Aztec inbox contract address on Ethereum Sepolia |
| `AZTEC_OUTBOX`             | Aztec outbox contract address on Ethereum Sepolia|
| `L2_ANCHOR_STATE_REGISTRY` | OP Stack anchor state registry address           |
| `L2_RPC_URL`               | Base Sepolia RPC URL                             |
| `L1_RPC_URL`               | Ethereum Sepolia RPC URL                         |
| `AZTEC_SECRET_KEY`         | Aztec deployer secret key                        |
| `AZTEC_SALT`               | Aztec deployer salt                              |
| `AZTEC_RPC_URL`            | Aztec node RPC URL                               |
| `L2_CHAIN_ID`              | L2 chain ID (84532 for Base Sepolia)             |

### Optional

| Variable            | Description                                          |
| ------------------- | ---------------------------------------------------- |
| `POSEIDON2`         | Existing Poseidon2 library address (skip deployment) |
| `VERIFY_CONTRACTS`  | Set to `true` to verify on block explorers           |
| `ETHERSCAN_API_KEY` | Etherscan API key for verification                   |
| `BASESCAN_API_KEY`  | Basescan API key for verification                    |

## Deploy Bridge Contracts

The bridge deployment script handles deploying all required contracts in the correct order:

1. **Poseidon2** (on Base Sepolia) - Cryptographic library
2. **L2Gateway7683** (on Base Sepolia) - EVM-side gateway contract
3. **Forwarder** (on Ethereum Sepolia) - Cross-chain message forwarder
4. **AztecGateway7683** (on Aztec) - Aztec-side gateway contract

### Deploy All Bridge Contracts

From the repository root:

```bash
yarn deploy:bridge
```

This command:
1. Deploys the Poseidon2 library (or uses existing if `POSEIDON2` is set)
2. Deploys L2Gateway7683 on Base Sepolia
3. Deploys Forwarder on Ethereum Sepolia
4. Deploys AztecGateway7683 on Aztec
5. Configures all contracts to reference each other
6. Saves deployment addresses to `deployments/deploy_YYYY-MM-DD_HH-MM-SS.json`

### Deployment Output

The deployment creates a JSON file with all contract addresses:

```json
{
  "timestamp": "2026-01-28T12:00:00.000Z",
  "Poseidon2": {
    "address": "0x...",
    "deployTx": "0x..."
  },
  "L2Gateway7683": {
    "address": "0x...",
    "deployTx": "0x...",
    "configTxs": ["0x...", "0x..."]
  },
  "Forwarder": {
    "address": "0x...",
    "deployTx": "0x...",
    "configTx": "0x..."
  },
  "AztecGateway7683": {
    "address": "0x...",
    "deployTx": "0x..."
  }
}
```

## Deploy Test Tokens

Test tokens are useful for development and E2E testing.

### Environment Variables

| Variable                 | Description                                 |
| ------------------------ | ------------------------------------------- |
| `PRIVATE_KEY`            | EVM deployer private key                    |
| `L2_RPC_URL`             | Base Sepolia RPC URL                        |
| `AZTEC_SECRET_KEY`       | Aztec deployer secret key                   |
| `AZTEC_SALT`             | Aztec deployer salt                         |
| `AZTEC_RPC_URL`          | Aztec RPC URL                               |
| `EVM_E2E_TEST_ADDRESS`   | (Optional) EVM address to receive tokens    |
| `EVM_FILLER_ADDRESS`     | (Optional) EVM filler address for tokens    |
| `AZTEC_E2E_TEST_ADDRESS` | (Optional) Aztec address to receive tokens  |
| `AZTEC_FILLER_ADDRESS`   | (Optional) Aztec filler address for tokens  |

### Deploy Both EVM and Aztec Tokens

```bash
yarn deploy:tokens
```

### Deploy Only EVM Token

```bash
yarn deploy:tokens evm
```

### Deploy Only Aztec Token

```bash
yarn deploy:tokens aztec
```

### Token Deployment Output

Token deployments are saved to `deployments/tokens_deploy_YYYY-MM-DD_HH-MM-SS.json`:

```json
{
  "timestamp": "2026-01-28T12:00:00.000Z",
  "EVMToken": {
    "address": "0x...",
    "deployTx": "0x..."
  },
  "AztecToken": {
    "address": "0x...",
    "deployTx": "0x..."
  }
}
```

## Manual Contract Deployment

For more control, you can deploy contracts individually.

### EVM Contracts (Foundry)

Build contracts:

```bash
cd packages/evm
forge build
```

Deploy L2Gateway7683:

```bash
forge create --broadcast \
  --private-key $PRIVATE_KEY \
  --rpc-url $L2_RPC_URL \
  src/L2Gateway7683.sol:L2Gateway7683 \
  --constructor-args $PERMIT2_ADDRESS
```

Deploy Forwarder:

```bash
forge create --broadcast \
  --private-key $PRIVATE_KEY \
  --rpc-url $L1_RPC_URL \
  src/Forwarder.sol:Forwarder \
  --constructor-args \
    $L2_GATEWAY_ADDRESS \
    $AZTEC_INBOX \
    $AZTEC_OUTBOX \
    $ANCHOR_STATE_REGISTRY
```

### Aztec Contracts

Build contracts:

```bash
cd packages/aztec/aztec_gateway_7683
aztec-nargo compile
aztec codegen target --outdir target --force
```

Deploy AztecGateway7683:

```bash
yarn deploy \
  $AZTEC_SECRET_KEY \
  $AZTEC_SALT \
  $L2_GATEWAY_ADDRESS \
  $L2_GATEWAY_DOMAIN \
  $FORWARDER_ADDRESS \
  $AZTEC_RPC_URL
```

## Contract Configuration

After deploying all contracts, they must be configured to reference each other.

### Set Aztec Gateway on Forwarder

```bash
cast send $FORWARDER_ADDRESS \
  "setAztecGateway7683(bytes32)" $AZTEC_GATEWAY_ADDRESS \
  --private-key $PRIVATE_KEY \
  --rpc-url $L1_RPC_URL
```

### Set Aztec Gateway on L2Gateway7683

```bash
cast send $L2_GATEWAY_ADDRESS \
  "setAztecGateway7683(bytes32)" $AZTEC_GATEWAY_ADDRESS \
  --private-key $PRIVATE_KEY \
  --rpc-url $L2_RPC_URL
```

### Set Forwarder on L2Gateway7683

```bash
cast send $L2_GATEWAY_ADDRESS \
  "setForwarder(address)" $FORWARDER_ADDRESS \
  --private-key $PRIVATE_KEY \
  --rpc-url $L2_RPC_URL
```

## Verification

To verify contracts on block explorers, set these environment variables before deployment:

```bash
export VERIFY_CONTRACTS=true
export ETHERSCAN_API_KEY=your_etherscan_key
export BASESCAN_API_KEY=your_basescan_key
```

## Troubleshooting

### "Failed to parse deployment address"

Ensure your RPC URLs are correct and the deployer account has sufficient funds.

### "Missing required configuration"

Check that all required environment variables are set in your `.env` file.

### "Transaction reverted"

Verify constructor arguments are correct and contract dependencies are deployed first.

### Aztec deployment fails

Ensure the Aztec sandbox is running or you have access to the Aztec testnet:

```bash
# Start local sandbox
aztec start sandbox
```
