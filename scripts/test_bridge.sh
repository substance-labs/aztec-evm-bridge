#!/bin/bash
set -e

# Check if deployment file is provided
if [ -z "$1" ]; then
    echo "Usage: $0 <path-to-deployment-json>"
    exit 1
fi

# Check for jq
if ! command -v jq &> /dev/null; then
    echo "Error: jq is not installed."
    exit 1
fi

DEPLOYMENT_FILE=$1

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
check_env "AZTEC_SECRET_KEY"
check_env "AZTEC_SALT"
check_env "PRIVATE_KEY" # Used as EVM PK
check_env "L2_CHAIN_ID"
check_env "AZTEC_RPC_URL"
check_env "AZTEC_TOKEN_ADDRESS"
check_env "L2_EVM_TOKEN_ADDRESS"
check_env "AZTEC_RECIPIENT_ADDRESS"
check_env "EVM_RECIPIENT_ADDRESS"

# Extract addresses from deployment JSON
if [ ! -f "$DEPLOYMENT_FILE" ]; then
    echo "Error: Deployment file $DEPLOYMENT_FILE not found."
    exit 1
fi

echo "Reading deployment from $DEPLOYMENT_FILE..."

L2_GATEWAY_ADDRESS=$(jq -r '.L2Gateway7683.address' "$DEPLOYMENT_FILE")
AZTEC_GATEWAY_ADDRESS=$(jq -r '.AztecGateway7683.address' "$DEPLOYMENT_FILE")

if [ "$L2_GATEWAY_ADDRESS" == "null" ] || [ "$AZTEC_GATEWAY_ADDRESS" == "null" ]; then
    echo "Error: Could not extract addresses from deployment file."
    exit 1
fi

echo "L2 Gateway: $L2_GATEWAY_ADDRESS"
echo "Aztec Gateway: $AZTEC_GATEWAY_ADDRESS"

# Run Aztec to EVM test
echo "Running Aztec to EVM E2E test..."
cd packages/aztec/aztec_gateway_7683

# Arguments: aztecSecretKey, aztecSalt, aztecGateway7683Address, l2Gateway7683Address, l2Gateway7683Domain, aztecTokenAddress, l2EvmTokenAddress, recipientAddress, rpcUrl
NODE_NO_WARNINGS=1 node --loader ts-node/esm scripts/e2e/aztec-to-evm.ts \
    "$AZTEC_SECRET_KEY" \
    "$AZTEC_SALT" \
    "$AZTEC_GATEWAY_ADDRESS" \
    "$L2_GATEWAY_ADDRESS" \
    "$L2_CHAIN_ID" \
    "$AZTEC_TOKEN_ADDRESS" \
    "$L2_EVM_TOKEN_ADDRESS" \
    "$EVM_RECIPIENT_ADDRESS" \
    "$AZTEC_RPC_URL"

echo "Aztec to EVM test passed!"

# Run EVM to Aztec test
echo "Running EVM to Aztec E2E test..."

# Arguments: aztecSecretKey, aztecSalt, evmPk, aztecGateway7683Address, l2Gateway7683Address, l2Gateway7683Domain, aztecTokenAddress, l2EvmTokenAddress, recipientAddress, rpcUrl
NODE_NO_WARNINGS=1 node --loader ts-node/esm scripts/e2e/evm-to-aztec.ts \
    "$AZTEC_SECRET_KEY" \
    "$AZTEC_SALT" \
    "$PRIVATE_KEY" \
    "$AZTEC_GATEWAY_ADDRESS" \
    "$L2_GATEWAY_ADDRESS" \
    "$L2_CHAIN_ID" \
    "$AZTEC_TOKEN_ADDRESS" \
    "$L2_EVM_TOKEN_ADDRESS" \
    "$AZTEC_RECIPIENT_ADDRESS" \
    "$AZTEC_RPC_URL"

echo "EVM to Aztec test passed!"
