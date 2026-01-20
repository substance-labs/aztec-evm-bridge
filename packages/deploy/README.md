# @substancelabs/deploy

Deployment scripts for the Aztec EVM Bridge.

## Usage

### Deploy Bridge Contracts

Deploys the full bridge infrastructure (L2Gateway, Forwarder, AztecGateway):

```bash
yarn deploy:bridge
```

### Deploy Test Tokens

Deploys test tokens on both EVM and Aztec:

```bash
# Deploy both EVM and Aztec tokens
yarn deploy:tokens

# Deploy only EVM token
yarn deploy:tokens evm

# Deploy only Aztec token
yarn deploy:tokens aztec
```

## Environment Variables

### Required for Bridge Deployment

| Variable                   | Description               |
| -------------------------- | ------------------------- |
| `PRIVATE_KEY`              | EVM deployer private key  |
| `PERMIT2`                  | Permit2 contract address  |
| `AZTEC_INBOX`              | Aztec inbox address       |
| `AZTEC_OUTBOX`             | Aztec outbox address      |
| `L2_ANCHOR_STATE_REGISTRY` | L2 anchor state registry  |
| `L2_RPC_URL`               | Base Sepolia RPC URL      |
| `L1_RPC_URL`               | Eth Sepolia RPC URL       |
| `AZTEC_SECRET_KEY`         | Aztec deployer secret key |
| `AZTEC_SALT`               | Aztec deployer salt       |
| `AZTEC_RPC_URL`            | Aztec RPC URL             |
| `L2_CHAIN_ID`              | L2 chain ID               |

### Optional

| Variable            | Description                                          |
| ------------------- | ---------------------------------------------------- |
| `POSEIDON2`         | Existing Poseidon2 library address (skip deployment) |
| `VERIFY_CONTRACTS`  | Set to `true` to verify on block explorers           |
| `ETHERSCAN_API_KEY` | Etherscan API key for verification                   |
| `BASESCAN_API_KEY`  | Basescan API key for verification                    |

### Required for Token Deployment

| Variable           | Description               |
| ------------------ | ------------------------- |
| `PRIVATE_KEY`      | EVM deployer private key  |
| `L2_RPC_URL`       | Base Sepolia RPC URL      |
| `AZTEC_SECRET_KEY` | Aztec deployer secret key |
| `AZTEC_SALT`       | Aztec deployer salt       |
| `AZTEC_RPC_URL`    | Aztec RPC URL             |

### Optional for Token Distribution

| Variable                 | Description                                 |
| ------------------------ | ------------------------------------------- |
| `EVM_E2E_TEST_ADDRESS`   | EVM address to receive test tokens          |
| `EVM_FILLER_ADDRESS`     | EVM filler address to receive test tokens   |
| `AZTEC_E2E_TEST_ADDRESS` | Aztec address to receive test tokens        |
| `AZTEC_FILLER_ADDRESS`   | Aztec filler address to receive test tokens |

## Output

Deployments are saved to `deployments/` directory with timestamps:

- `deploy_YYYY-MM-DD_HH-MM-SS.json` - Bridge deployment
- `tokens_deploy_YYYY-MM-DD_HH-MM-SS.json` - Token deployment
