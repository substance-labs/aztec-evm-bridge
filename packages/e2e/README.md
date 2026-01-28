# @substancelabs/e2e

End-to-end tests for the Aztec-EVM Bridge.

## Scripts

| Command | Description |
| ------- | ----------- |
| `yarn test:bridge` | Run full bridge E2E tests |
| `yarn deploy:bridge` | Deploy bridge contracts |
| `yarn deploy:tokens` | Deploy test tokens |
| `yarn mint:aztec` | Mint Aztec tokens |

## Usage

### Run E2E Tests

```bash
yarn test:bridge <deployment-json> <tokens-json>
```

Example:

```bash
yarn test:bridge \
  ../../deployments/deploy_2026-01-28_12-00-00.json \
  ../../deployments/tokens_deploy_2026-01-28_12-30-00.json
```

### Prerequisites

Before running E2E tests:

1. Deploy bridge contracts
2. Deploy test tokens
3. Start the filler service
4. Configure environment variables

## Environment Variables

Create a `.env` file in the repository root with:

- Aztec credentials (secret key, salt)
- EVM private keys
- Test account addresses
- RPC URLs

See the [Testing Guide](../../docs/testing.md) for details.

## Documentation

- [Testing Guide](../../docs/testing.md)
- [Filler Guide](../../docs/filler.md)
