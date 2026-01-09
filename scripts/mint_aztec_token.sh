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
check_env "AZTEC_SECRET_KEY"
check_env "AZTEC_SALT"
check_env "AZTEC_RPC_URL"

# Use environment variables or arguments
TOKEN_ADDRESS=${1:-$AZTEC_TOKEN_ADDRESS}
RECIPIENT_ADDRESS=${2:-$AZTEC_RECIPIENT_ADDRESS}
AMOUNT_PRIVATE=${3:-1000000000000000000000}
AMOUNT_PUBLIC=${4:-1000000000000000000000}

if [ -z "$TOKEN_ADDRESS" ]; then
    echo "Error: Token address not provided. Set AZTEC_TOKEN_ADDRESS or pass as first argument."
    exit 1
fi

if [ -z "$RECIPIENT_ADDRESS" ]; then
    echo "Error: Recipient address not provided. Set AZTEC_RECIPIENT_ADDRESS or pass as second argument."
    exit 1
fi

echo "Minting Aztec tokens..."
echo "Token: $TOKEN_ADDRESS"
echo "Recipient: $RECIPIENT_ADDRESS"
echo "Private Amount: $AMOUNT_PRIVATE"
echo "Public Amount: $AMOUNT_PUBLIC"

cd packages/aztec/aztec_gateway_7683

NODE_NO_WARNINGS=1 node --loader ts-node/esm scripts/mint-tokens.ts \
    $AZTEC_SECRET_KEY \
    $AZTEC_SALT \
    $TOKEN_ADDRESS \
    $RECIPIENT_ADDRESS \
    $AMOUNT_PRIVATE \
    $AMOUNT_PUBLIC \
    $AZTEC_RPC_URL

echo "✅ Tokens minted successfully!"
