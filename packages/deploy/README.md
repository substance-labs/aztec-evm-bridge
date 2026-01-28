# @substancelabs/deploy

Deployment scripts for the Aztec-EVM Bridge infrastructure.

## Scripts

| Command | Description |
| ------- | ----------- |
| `yarn deploy:bridge` | Deploy full bridge infrastructure |
| `yarn deploy:tokens` | Deploy test tokens |

## Usage

### Deploy Bridge

Deploy all bridge contracts (Poseidon2, L2Gateway, Forwarder, AztecGateway):

```bash
yarn deploy:bridge
```

### Deploy Tokens

Deploy test tokens on both chains:

```bash
# Deploy both EVM and Aztec tokens
yarn deploy:tokens

# Deploy only EVM token
yarn deploy:tokens evm

# Deploy only Aztec token
yarn deploy:tokens aztec
```

## Environment Variables

See the [Deployment Guide](../../docs/deployment.md) for required environment variables.

## Output

Deployments are saved to `deployments/` directory:

- `deploy_YYYY-MM-DD_HH-MM-SS.json` - Bridge deployment
- `tokens_deploy_YYYY-MM-DD_HH-MM-SS.json` - Token deployment

## Documentation

- [Full Deployment Guide](../../docs/deployment.md)
