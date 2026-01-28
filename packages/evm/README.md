# @substancelabs/evm

Solidity smart contracts for the Aztec-EVM Bridge.

## Contracts

| Contract | Description |
| -------- | ----------- |
| `L2Gateway7683.sol` | ERC-7683 gateway contract on Base Sepolia |
| `Forwarder.sol` | Cross-chain message forwarder on Ethereum |
| `BasicSwap7683.sol` | Base swap implementation |
| `TestToken.sol` | ERC-20 test token |

## Prerequisites

- [Foundry](https://book.getfoundry.sh/getting-started/installation)

## Build

```bash
forge build
```

## Test

```bash
forge test
```

Run with verbosity:

```bash
forge test -vvv
```

## Deploy

See the [Deployment Guide](../../docs/deployment.md) for full deployment instructions.

### Quick Deploy

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

## Documentation

- [Deployment Guide](../../docs/deployment.md)
- [Testing Guide](../../docs/testing.md)
