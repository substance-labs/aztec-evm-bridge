#!/bin/bash
set -e

# Load environment variables
if [ -f .env ]; then
    export $(cat .env | grep -v '#' | awk '/=/ {print $1}')
fi

# Function to check if a variable is set
check_env() {
    if [ -z "${!1}" ]; then
        echo "Error: Environment variable $1 is not set."
        exit 1
    fi
}

# Check required environment variables
check_env "PRIVATE_KEY"
check_env "PERMIT2"
check_env "AZTEC_INBOX"
check_env "AZTEC_OUTBOX"
check_env "L2_ANCHOR_STATE_REGISTRY"
check_env "L2_RPC_URL"
check_env "L1_RPC_URL"
check_env "AZTEC_SECRET_KEY"
check_env "AZTEC_SALT"
check_env "AZTEC_RPC_URL"
check_env "L2_CHAIN_ID"

# Optional verification
VERIFY_CONTRACTS=${VERIFY_CONTRACTS:-false}
VERIFY_FLAGS=""
if [ "$VERIFY_CONTRACTS" = "true" ]; then
    echo "Contract verification enabled."
    VERIFY_FLAGS="--verify"
    # Check for Etherscan API keys if verification is enabled
    if [ -z "$ETHERSCAN_API_KEY" ] && [ -z "$BASESCAN_API_KEY" ]; then
        echo "Warning: Verification enabled but no API keys found (ETHERSCAN_API_KEY or BASESCAN_API_KEY)."
    fi
fi

TIMESTAMP=$(date +%Y-%m-%d_%H-%M-%S)
mkdir -p deployments
FINAL_OUTPUT_FILE="deployments/deploy_${TIMESTAMP}.json"

echo "Deploying contracts..."

# 1. Deploy Poseidon2 (Library) on Base Sepolia
echo "Deploying Poseidon2 on Base Sepolia..."
cd packages/evm
mkdir -p deployments
forge create --broadcast --private-key $PRIVATE_KEY --rpc-url $L2_RPC_URL src/libs/Poseidon2.sol:Poseidon2 $VERIFY_FLAGS > deployments/poseidon_deploy.txt
POSEIDON_ADDRESS=$(grep "Deployed to:" deployments/poseidon_deploy.txt | awk '{print $3}')
POSEIDON_TX_HASH=$(grep "Transaction hash:" deployments/poseidon_deploy.txt | awk '{print $3}')
echo "Poseidon2 deployed at: $POSEIDON_ADDRESS"

# 2. Deploy L2Gateway7683 on Base Sepolia
echo "Deploying L2Gateway7683 on Base Sepolia..."
# Using Deploy.s.sol with deployL2Gateway=true, deployForwarder=false
forge script script/Deploy.s.sol:Deploy --broadcast --rpc-url $L2_RPC_URL $VERIFY_FLAGS \
    --libraries src/libs/Poseidon2.sol:Poseidon2:$POSEIDON_ADDRESS \
    --sig "run(address,address,address,address,bytes32,bool,bool,bool,address)" \
    $PERMIT2 \
    $AZTEC_INBOX \
    $AZTEC_OUTBOX \
    $L2_ANCHOR_STATE_REGISTRY \
    "0x0000000000000000000000000000000000000000000000000000000000000000" \
    false \
    true \
    false \
    "0x0000000000000000000000000000000000000000" > deployments/l2_gateway_deploy.txt

L2_GATEWAY_ADDRESS=$(jq -r '.L2Gateway7683' deployments/deployment.json)
L2_CHAIN_ID_VAL=$(cast chain-id --rpc-url $L2_RPC_URL)
L2_GATEWAY_TX_HASH=$(jq -r '.transactions[] | select(.contractName == "L2Gateway7683") | .hash' broadcast/Deploy.s.sol/$L2_CHAIN_ID_VAL/run-latest.json)
echo "L2Gateway7683 deployed at: $L2_GATEWAY_ADDRESS"
mv deployments/deployment.json deployments/deployment_l2.json

# 3. Deploy Forwarder on Eth Sepolia
echo "Deploying Forwarder on Eth Sepolia..."
# Using Deploy.s.sol with deployL2Gateway=false, deployForwarder=true, passing L2Gateway address
forge script script/Deploy.s.sol:Deploy --broadcast --rpc-url $L1_RPC_URL $VERIFY_FLAGS --sig "run(address,address,address,address,bytes32,bool,bool,bool,address)" \
    $PERMIT2 \
    $AZTEC_INBOX \
    $AZTEC_OUTBOX \
    $L2_ANCHOR_STATE_REGISTRY \
    "0x0000000000000000000000000000000000000000000000000000000000000000" \
    false \
    false \
    true \
    $L2_GATEWAY_ADDRESS > deployments/forwarder_deploy.txt

FORWARDER_ADDRESS=$(jq -r '.Forwarder' deployments/deployment.json)
L1_CHAIN_ID_VAL=$(cast chain-id --rpc-url $L1_RPC_URL)
FORWARDER_TX_HASH=$(jq -r '.transactions[] | select(.contractName == "Forwarder") | .hash' broadcast/Deploy.s.sol/$L1_CHAIN_ID_VAL/run-latest.json)
echo "Forwarder deployed at: $FORWARDER_ADDRESS"
mv deployments/deployment.json deployments/deployment_l1.json
cd ../..

# 4. Deploy Aztec Gateway
echo "Deploying Aztec Gateway..."
# Assuming aztec-evm-bridge root is current dir
cd packages/aztec/aztec_gateway_7683
# Arguments: aztecSecretKey, aztecSalt, l2Gateway7683Address, l2Gateway7683Domain, forwarderAddress, rpcUrl, deployWallet, deployToken

NODE_NO_WARNINGS=1 node --loader ts-node/esm scripts/deploy.ts \
    $AZTEC_SECRET_KEY \
    $AZTEC_SALT \
    $L2_GATEWAY_ADDRESS \
    $L2_CHAIN_ID \
    $FORWARDER_ADDRESS \
    $AZTEC_RPC_URL \
    false \
    false

AZTEC_GATEWAY_ADDRESS=$(jq -r '.AztecGateway7683' deployments/deployment.json)
AZTEC_GATEWAY_TX_HASH=$(jq -r '.AztecGatewayDeploymentTx' deployments/deployment.json)
echo "Aztec Gateway deployed at: $AZTEC_GATEWAY_ADDRESS"
cd ../../..

# 5. Configure Contracts
echo "Configuring contracts..."
cd packages/evm

# Set Aztec Gateway on Forwarder (Eth Sepolia)
echo "Setting Aztec Gateway on Forwarder..."
forge script script/Config.s.sol:Config --broadcast --rpc-url $L1_RPC_URL --sig "run(address,address,bytes32,bool,bool)" \
    "0x0000000000000000000000000000000000000000" \
    $FORWARDER_ADDRESS \
    $AZTEC_GATEWAY_ADDRESS \
    true \
    false > deployments/forwarder_config.txt
FORWARDER_CONFIG_TX_HASH=$(jq -r '.transactions[] | select(.function == "setAztecGateway7683(bytes32)") | .hash' broadcast/Config.s.sol/$L1_CHAIN_ID_VAL/run-latest.json)

# Set Aztec Gateway and Forwarder on L2Gateway7683 (Base Sepolia)
echo "Setting Aztec Gateway and Forwarder on L2Gateway7683..."
forge script script/Config.s.sol:Config --broadcast --rpc-url $L2_RPC_URL --sig "run(address,address,bytes32,bool,bool)" \
    $L2_GATEWAY_ADDRESS \
    $FORWARDER_ADDRESS \
    $AZTEC_GATEWAY_ADDRESS \
    false \
    true > deployments/l2_gateway_config.txt
# Capture all tx hashes as a JSON array
L2_GATEWAY_CONFIG_TX_HASHES=$(jq -r '[.transactions[].hash]' broadcast/Config.s.sol/$L2_CHAIN_ID_VAL/run-latest.json)

cd ../..

# Create final JSON
echo "Saving deployment details to $FINAL_OUTPUT_FILE..."
jq -n \
    --arg poseidon "$POSEIDON_ADDRESS" \
    --arg poseidonTx "$POSEIDON_TX_HASH" \
    --arg l2Gateway "$L2_GATEWAY_ADDRESS" \
    --arg l2GatewayTx "$L2_GATEWAY_TX_HASH" \
    --arg forwarder "$FORWARDER_ADDRESS" \
    --arg forwarderTx "$FORWARDER_TX_HASH" \
    --arg aztecGateway "$AZTEC_GATEWAY_ADDRESS" \
    --arg aztecGatewayTx "$AZTEC_GATEWAY_TX_HASH" \
    --arg forwarderConfigTx "$FORWARDER_CONFIG_TX_HASH" \
    --argjson l2GatewayConfigTxs "$L2_GATEWAY_CONFIG_TX_HASHES" \
    '{
        Poseidon2: {
            address: $poseidon,
            deployTx: $poseidonTx
        },
        L2Gateway7683: {
            address: $l2Gateway,
            deployTx: $l2GatewayTx,
            configTxs: $l2GatewayConfigTxs
        },
        Forwarder: {
            address: $forwarder,
            deployTx: $forwarderTx,
            configTx: $forwarderConfigTx
        },
        AztecGateway7683: {
            address: $aztecGateway,
            deployTx: $aztecGatewayTx
        }
    }' > "$FINAL_OUTPUT_FILE"

echo "Deployment and configuration complete!"
