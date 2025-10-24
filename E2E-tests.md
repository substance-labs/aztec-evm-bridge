# End-to-End Test Scripts

The repository includes scripts to exercise both directions of the bridge. Run them from the respective package directories after the filler is up:

## Required components

### EVM contracts

Build and deploy EVM contracts following [`packages/evm/README.md`](packages/evm/README.md).

### Aztec contracts

Build and deploy Aztec contracts following [`packages/aztec/aztec_gateway_7683/README.md`](packages/aztec/aztec_gateway_7683/README.md).

### Filler

Run and configure the filler following [`packages/filler/README.md`](packages/filler/README.md).

## Configure Contracts

#### Set Aztec Gateway on Forwarder 

```bash
cast send <0xForwarderAddress> \
    "setAztecGateway7683(bytes32)" <0xAztecGateway> 
    --private-key <private-key>
     --rpc-url <rpc-url>
```

#### Set Aztec Gateway on L2Gateway7683 

```bash
cast send <0xL2Gateway7683> \
    "setAztecGateway7683(bytes32)" <0xAztecGateway> 
    --private-key <private-key>
     --rpc-url <rpc-url>
```

#### Set Forwarder on L2Gateway7683 

```bash
cast send <0xL2Gateway7683> \
    "setForwarder(address)" <0xForwarderAddress> 
    --private-key <private-key>
     --rpc-url <rpc-url>
```

## Optional - deploy test tokens

#### AztecToken

```bash
NODE_NO_WARNINGS=1 node --loader ts-node/esm packages/aztec/aztec_gateway_7683/scripts/deploy-token.ts        
    <aztec-secret-key> \
    <aztec-salt> \ 
    <token-name> <token-symbol> <decimals> \
    <aztec-rpc-url>
```
#### EVMToken

```bash
forge create --broadcast \
    --private-key <private-key> \
    packages/evm/src/TestToken.sol:TestToken \
    --rpc-url <rpc-url> \
    --constructor-args <token-name> <token-symbol> <decimals> <total-supply>
```

## Run tests

### Base Sepolia → Aztec

```bash
NODE_NO_WARNINGS=1 node --loader ts-node/esm packages/aztec/aztec_gateway_7683/scripts/e2e/evm-to-aztec.ts \
  <aztec-secret-key> \
  <aztec-salt> \
  <evm-private-key> \
  <aztec-gateway-addr> \
  <l2-gateway-addr> \
  <l2-gateway-domain> \
  <aztec-token-addr> \
  <l2-token-addr> \
  <aztec-recipient-addr>
```

The script approves tokens on Base Sepolia, opens an order on the L2 gateway, and polls the Aztec gateway until it observes the order transitioning to `filled`.

### Aztec → Base Sepolia

```bash
NODE_NO_WARNINGS=1 node --loader ts-node/esm packages/aztec/aztec_gateway_7683/scripts/e2e/aztec-to-evm.ts \
  <aztec-secret-key> \
  <aztec-salt> \
  <aztec-gateway-addr> \
  <l2-gateway-addr> \
  <l2-gateway-domain> \
  <aztec-token-addr> \
  <l2-token-addr> \
  <evm-recipient-addr>
```

This script opens a private order on Aztec and polls the Base Sepolia gateway for the fill status.

Each script expects the filler to be alive and monitoring both chains; it should detect the new order, execute the necessary transactions, and log the settlement hash.