# Running the Filler

This guide explains how to configure and operate the filler so it can automatically pick up `Open` events on the EVM L2 (Base Sepolia) and Aztec, fill them, and forward settlements.

## Prerequisites

- Node.js (use the version from `.nvmrc`) and Yarn installed locally.
- Access to the Aztec sandbox (via `aztec start sandbox`) or a remote Aztec node.
- A funded EVM L2 (Base Sepolia) account with the tokens the filler will spend.
- EVM L2 RPC endpoints that support filter-based log queries (`eth_newFilter` / contract event filters). Some public RPCs disable this; use an archive-capable provider that allows `createContractEventFilter`.
- The gateway contracts deployed and the addresses recorded (see the bridge repository instructions).
- MongoDB running and reachable.

## Install Dependencies

```bash
cd packages/filler
nvm use
yarn install
```

## Environment Configuration

Copy the provided template and edit it with your values:

```bash
cp .env.example .env
# open .env and populate each variable
```

The most important options are:

| Variable | Purpose |
| --- | --- |
| `MONGO_URL` / `MONGO_DB_NAME` | MongoDB connection for persisting order state. |
| `AZTEC_RPC_URL` | URL of the Aztec node or sandbox PXE (`http://localhost:8080` when using `aztec start sandbox`). |
| `AZTEC_SECRET_KEY`, `AZTEC_SALT` | Credentials for the Aztec account that signs private fills. |
| `PK_EVM` | EVM L2 (Base Sepolia) private key to fill orders on the EVM side. |
| `EVM_L2_RPC_URL`, `FORWARDER_RPC_URL` | RPC endpoints for the EVM L2 (Base Sepolia) and the L1 chain that hosts the forwarder contract. |
| `AZTEC_GATEWAY_ADDRESS`, `L2_EVM_GATEWAY_ADDRESS`, `FORWARDER_ADDRESS` | Contract addresses deployed earlier. |
| `OP_STACK_ANCHOR_REGISTRY_ADDRESS`, `AZTEC_ROLLUP_CONTRACT_L1_ADDRESS` | Used when forwarding settlements to Aztec/L2. Optional in sandbox. |
| `AZTEC_SANDBOX` | Set to `true` when running against the sandbox so settlement forwarding skips the rollup proof requirement. |

## Sync Contract Artifacts

The filler embeds the Aztec gateway artifact generated in `packages/aztec/aztec_gateway_7683`. Whenever that project is rebuilt, copy the updated files into the filler before compiling:

```bash
# from packages/filler
cp ../aztec/aztec_gateway_7683/src/artifacts/AztecGateway7683.ts src/artifacts/AztecGateway7683/
cp ../aztec/aztec_gateway_7683/target/aztec_gateway_7683-AztecGateway7683.json src/artifacts/AztecGateway7683/
```

These copies keep the filler’s TypeScript bindings and bytecode in sync with the deployed Aztec gateway contract.

## Build and Run

1. Compile the TypeScript sources:
   ```bash
    yarn build
   ```
2. Start the filler:
   ```bash
    yarn start
   ```

The filler will bootstrap a PXE instance, register the necessary contracts, and start two watchers:
- **BaseSepoliaWatcher** scans the L2 gateway for `Open` events to fill Aztec-destined orders.
- **AztecWatcher** scans the Aztec gateway for orders that need to be filled on Base Sepolia.

Log messages state the block ranges queried and list each order ID as it is processed. All processed orders are stored in MongoDB under the `orders` collection.

## Sandbox Considerations

When working with `aztec start sandbox`:

- Make sure the sandbox wallet has enough Aztec tokens; use the provided minting script if necessary.
- Set `AZTEC_SANDBOX=true` in `.env` to allow settlement forwarding without querying the non-existent L1 rollup contract.
- With `AZTEC_SANDBOX=true` the filler **skips the L2 settlement forwarding step entirely**. Orders are marked as settled in the database so the flow continues, but **no `settle` transaction is sent to the EVM gateway**. This is expected in sandbox mode; switch the flag off when you connect to a deployment that has the rollup contract and message bridge so real settlements happen on L2. There is no L2→L1 messaging bridge in the sandbox, so transactions like `forwardSettleToL2` will always fail if attempted. The filler’s sandbox mode avoids calling them; just be aware nothing is finalized on EVM L2 while running locally.
- The PXE is launched locally by the filler under `store/filler-pxe`. Remove the directory if you need a clean state between runs.

## Troubleshooting

- **Watcher logs show no events:** confirm RPC URLs and block ranges; ensure the gateway contracts emit the `Open` events by checking the explorer or using `cast logs`.
- **`getProvenBlockNumber` errors:** set `AZTEC_SANDBOX=true` when using the sandbox. On testnet, verify `AZTEC_ROLLUP_CONTRACT_L1_ADDRESS` is correct. **In this mode it is not possible to settle because L2→L1 messaging is not available**; this settlement is skipped.
- **Insufficient funds:** make sure the Base Sepolia filler account holds enough ETH and tokens for approvals, fills, and gas.
- **PXE already processing jobs:** this is normal when the filler submits transactions back-to-back; it queues them until earlier jobs finish.

With the environment configured and the filler running, both cross-chain directions can be exercised using the provided scripts or your own workflow.
