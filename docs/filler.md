# Filler Guide

The filler is a service that monitors cross-chain orders and fulfills them by providing liquidity on destination chains. This guide covers configuration, running, and operating the filler.

## Overview

The filler performs these key functions:

1. **Monitors orders** on both Aztec and Base Sepolia gateways
2. **Fills orders** by providing liquidity on the destination chain
3. **Forwards settlements** to enable the filler to reclaim locked funds
4. **Tracks state** in MongoDB for persistence and recovery

## Prerequisites

- Node.js v20+ and Yarn v4+
- MongoDB instance (local or remote)
- Funded accounts on:
  - Base Sepolia (ETH + tokens to fill)
  - Aztec (tokens to fill)
- Deployed bridge contracts (see [Deployment Guide](./deployment.md))

## Installation

```bash
cd packages/filler
yarn install
```

## Configuration

### Environment Variables

Create a `.env` file in `packages/filler/`:

```bash
# MongoDB Configuration
MONGO_DB_URI=mongodb://localhost:27017
MONGO_DB_USER=filler              # Optional if no auth
MONGO_DB_PASSWORD=filler          # Optional if no auth
MONGO_DB_AUTH_SOURCE=admin        # Optional
MONGO_DB_NAME=filler

# EVM Configuration
EVM_L2_RPC_URL=https://sepolia.base.org
EVM_L2_CHAIN_ID=84532
FORWARDER_RPC_URL=https://sepolia.drpc.org
FORWARDER_CHAIN_ID=11155111
PK_EVM=0x...                      # Filler's EVM private key
BEACON_API_URL=https://...        # Ethereum beacon API

# Contract Addresses
L2_EVM_GATEWAY_ADDRESS=0x...      # L2Gateway7683 on Base Sepolia
FORWARDER_ADDRESS=0x...           # Forwarder on Ethereum Sepolia
OP_STACK_ANCHOR_REGISTRY_ADDRESS=0x...
AZTEC_ROLLUP_CONTRACT_L1_ADDRESS=0x...

# Aztec Configuration
AZTEC_RPC_URL=http://localhost:8080
AZTEC_GATEWAY_ADDRESS=0x...       # AztecGateway7683
AZTEC_SECRET_KEY=0x...            # Filler's Aztec secret key
AZTEC_SALT=0x...                  # Filler's Aztec salt
AZTEC_PROVER_ENABLED=false
AZTEC_SANDBOX=false               # Set true for sandbox mode

# Token Addresses
L2_EVM_TOKEN_ADDRESS=0x...
AZTEC_TOKEN_ADDRESS=0x...

# Watch Intervals
EVM_WATCH_INTERVAL_TIME_MS=5000
AZTEC_WATCH_INTERVAL_TIME_MS=5000
BALANCE_CHECK_INTERVAL_MS=60000
```

### Using Deployment JSON Files

The filler can auto-load contract addresses from deployment JSON files:

```bash
# Set paths to deployment files
DEPLOYMENT_JSON_PATH=../../deployments/deploy_2026-01-28_12-00-00.json
TOKENS_JSON_PATH=../../deployments/tokens_deploy_2026-01-28_12-30-00.json
```

If these are set, contract addresses are loaded from the JSON files, and individual address environment variables become optional.

## Running the Filler

### Development Mode

Start with hot reload for development:

```bash
yarn dev
```

### Production Mode

Build and run:

```bash
yarn build
yarn start
```

### MongoDB

Start a local MongoDB instance:

```bash
yarn mongo:start
```

Stop MongoDB:

```bash
yarn mongo:stop
```

Remove MongoDB container:

```bash
yarn mongo:remove
```

## Running with Docker

Docker Compose provides the easiest way to run the filler with all dependencies.

### Docker Compose Setup

The `docker-compose.yml` includes:

- **mongodb**: MongoDB 7 for state persistence
- **filler**: The filler service

### Configuration for Docker

Create a `.env` file in `packages/filler/` with your configuration. Docker Compose reads from this file.

### Start Services

```bash
cd packages/filler
docker compose up -d
```

### View Logs

```bash
docker compose logs -f filler
```

### Stop Services

```bash
docker compose down
```

### Rebuild After Code Changes

```bash
docker compose build --no-cache
docker compose up -d
```

### Docker Environment Variables

The Docker Compose file maps these variables:

| Variable | Default | Description |
| -------- | ------- | ----------- |
| `MONGO_DB_USER` | `filler` | MongoDB username |
| `MONGO_DB_PASSWORD` | `filler` | MongoDB password |
| `MONGO_DB_NAME` | `filler` | Database name |
| `EVM_L2_CHAIN_ID` | `84532` | Base Sepolia chain ID |
| `FORWARDER_CHAIN_ID` | `11155111` | Sepolia chain ID |
| `AZTEC_PROVER_ENABLED` | `false` | Enable Aztec prover |
| `AZTEC_SANDBOX` | `false` | Sandbox mode |

### Mounting Deployment Files

The Docker Compose config mounts `../../deployments` to `/app/deployments`. Set the file names:

```bash
DEPLOYMENT_JSON_FILE=deploy_2026-01-28_12-00-00.json
TOKENS_JSON_FILE=tokens_deploy_2026-01-28_12-30-00.json
```

## Sandbox Mode

When running against the Aztec sandbox (`aztec start sandbox`):

1. Set `AZTEC_SANDBOX=true` in your `.env`
2. The filler will skip L2 settlement forwarding (not available in sandbox)
3. Orders are marked as settled in the database but no settle transaction is sent

**Important**: In sandbox mode, L2→L1 messaging is not available, so settlements cannot be finalized on EVM L2.

## Syncing Contract Artifacts

When the Aztec gateway contract is rebuilt, sync artifacts to the filler:

```bash
cd packages/filler

# Copy TypeScript bindings
cp ../aztec/aztec_gateway_7683/src/artifacts/AztecGateway7683.ts \
   src/artifacts/AztecGateway7683/

# Copy compiled contract
cp ../aztec/aztec_gateway_7683/target/aztec_gateway_7683-AztecGateway7683.json \
   src/artifacts/AztecGateway7683/
```

## Architecture

### Watchers

The filler runs two watchers:

- **EvmWatcher**: Scans Base Sepolia gateway for `Open` events
- **AztecWatcher**: Scans Aztec gateway for orders needing EVM fills

### Order Flow

1. **Order detected**: Watcher finds new `Open` event
2. **Order stored**: Order saved to MongoDB with `pending` status
3. **Fill executed**: Filler sends fill transaction on destination chain
4. **Status updated**: Order marked as `filled`
5. **Settlement forwarded**: Cross-chain message sent for settlement
6. **Order completed**: Final status updated

### Database Schema

Orders are stored in MongoDB with this structure:

```typescript
{
  orderId: string
  status: 'pending' | 'filling' | 'filled' | 'settling' | 'settled' | 'error'
  sourceChain: string
  destinationChain: string
  amount: string
  fillTxHash?: string
  settleTxHash?: string
  error?: string
  createdAt: Date
  updatedAt: Date
}
```

## Monitoring

### Logs

The filler logs provide visibility into operations:

- Block ranges being scanned
- Orders detected and processed
- Fill and settlement transactions
- Errors and retries

### Health Checks

Monitor these indicators:

- MongoDB connection status
- RPC endpoint connectivity
- Order processing latency
- Fill success rate

## Troubleshooting

### "Watcher logs show no events"

- Verify RPC URLs are correct
- Check that gateway contracts are deployed at the configured addresses
- Use `cast logs` to manually check for events on the explorer

### "getProvenBlockNumber errors"

- Set `AZTEC_SANDBOX=true` when using the sandbox
- On testnet, verify `AZTEC_ROLLUP_CONTRACT_L1_ADDRESS` is correct

### "Insufficient funds"

- Fund the filler's Base Sepolia account with ETH and tokens
- Fund the filler's Aztec account with tokens

### "PXE already processing jobs"

This is normal behavior when transactions are queued. The filler queues transactions until earlier jobs complete.

### MongoDB connection issues

- Verify MongoDB is running: `docker ps`
- Check connection string: `MONGO_DB_URI`
- Verify credentials if using authentication

### "Cannot read properties of undefined"

- Ensure deployment JSON files exist at configured paths
- Check that all required environment variables are set

## Configuration Reference

### Complete Environment Variable Reference

| Variable | Required | Default | Description |
| -------- | -------- | ------- | ----------- |
| `MONGO_DB_URI` | Yes | - | MongoDB connection URI |
| `MONGO_DB_NAME` | No | `filler` | Database name |
| `MONGO_DB_USER` | No | - | MongoDB username |
| `MONGO_DB_PASSWORD` | No | - | MongoDB password |
| `MONGO_DB_AUTH_SOURCE` | No | - | Auth database |
| `EVM_L2_RPC_URL` | Yes | - | Base Sepolia RPC |
| `EVM_L2_CHAIN_ID` | No | `84532` | L2 chain ID |
| `FORWARDER_RPC_URL` | Yes | - | Ethereum Sepolia RPC |
| `FORWARDER_CHAIN_ID` | No | `11155111` | L1 chain ID |
| `PK_EVM` | Yes | - | EVM private key |
| `BEACON_API_URL` | Yes | - | Ethereum beacon API |
| `L2_EVM_GATEWAY_ADDRESS` | Yes* | - | L2Gateway address |
| `FORWARDER_ADDRESS` | Yes* | - | Forwarder address |
| `OP_STACK_ANCHOR_REGISTRY_ADDRESS` | Yes | - | OP Stack registry |
| `AZTEC_ROLLUP_CONTRACT_L1_ADDRESS` | Yes | - | Aztec rollup address |
| `AZTEC_RPC_URL` | Yes | - | Aztec node RPC |
| `AZTEC_GATEWAY_ADDRESS` | Yes* | - | AztecGateway address |
| `AZTEC_SECRET_KEY` | Yes | - | Aztec secret key |
| `AZTEC_SALT` | Yes | - | Aztec salt |
| `AZTEC_TOKEN_ADDRESS` | Yes* | - | Aztec token address |
| `L2_EVM_TOKEN_ADDRESS` | Yes* | - | EVM token address |
| `AZTEC_PROVER_ENABLED` | No | `false` | Enable prover |
| `AZTEC_SANDBOX` | No | `false` | Sandbox mode |
| `EVM_WATCH_INTERVAL_TIME_MS` | No | `5000` | EVM polling interval |
| `AZTEC_WATCH_INTERVAL_TIME_MS` | No | `5000` | Aztec polling interval |
| `BALANCE_CHECK_INTERVAL_MS` | No | `60000` | Balance check interval |
| `DEPLOYMENT_JSON_PATH` | No | - | Path to deployment JSON |
| `TOKENS_JSON_PATH` | No | - | Path to tokens JSON |

*Can be loaded from deployment JSON if `DEPLOYMENT_JSON_PATH` is set.
