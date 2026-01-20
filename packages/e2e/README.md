# E2E Tests and Deployment Scripts

This package contains end-to-end tests and deployment scripts for the Aztec-EVM bridge.

## Scripts

- `test:bridge` - Run bridge E2E tests
- `deploy:bridge` - Deploy bridge contracts
- `deploy:tokens` - Deploy test tokens
- `mint:aztec` - Mint Aztec tokens for testing

## Usage

```bash
# Run bridge tests
yarn test:bridge <deployment-json> <tokens-json>

# Deploy bridge
yarn deploy:bridge

# Deploy tokens
yarn deploy:tokens

# Mint tokens
yarn mint:aztec <tokens-json> <recipient> <private-amount> <public-amount>
```
