# @substancelabs/aztec-gateway-7683

Aztec Noir contracts implementing ERC-7683 for cross-chain bridging.

## Prerequisites

- [Aztec CLI](https://docs.aztec.network/developers/getting_started)

## Build

```bash
# Compile Noir contracts
aztec compile

# Generate TypeScript bindings
aztec codegen target --outdir target --force
```

## Test

```bash
# Run all tests
yarn test

# Run only Noir tests
yarn test:nr

# Run only JavaScript tests
yarn test:js
```

## Deploy

```bash
yarn deploy \
  $AZTEC_SECRET_KEY \
  $AZTEC_SALT \
  $L2_GATEWAY_ADDRESS \
  $L2_GATEWAY_DOMAIN \
  $FORWARDER_ADDRESS \
  $AZTEC_RPC_URL
```

## Scripts

| Command | Description |
| ------- | ----------- |
| `yarn build` | Compile and generate bindings |
| `yarn compile` | Compile Noir contracts |
| `yarn codegen` | Generate TypeScript bindings |
| `yarn test` | Run all tests |
| `yarn deploy` | Deploy gateway contract |

## Documentation

- [Deployment Guide](../../../docs/deployment.md)
- [Testing Guide](../../../docs/testing.md)
