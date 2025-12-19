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

DEPLOY_TYPE=${1:-all}

if [ "$DEPLOY_TYPE" != "all" ] && [ "$DEPLOY_TYPE" != "evm" ] && [ "$DEPLOY_TYPE" != "aztec" ]; then
    echo "Usage: $0 [all|evm|aztec]"
    exit 1
fi

EVM_TOKEN_ADDRESS=""
AZTEC_TOKEN_ADDRESS=""

if [ "$DEPLOY_TYPE" == "all" ] || [ "$DEPLOY_TYPE" == "evm" ]; then
    echo "Deploying EVM Test Token..."
    cd packages/evm
    mkdir -p ../../deployments
    forge create --broadcast --private-key $PRIVATE_KEY --rpc-url $L2_RPC_URL src/TestToken.sol:TestToken --constructor-args "Test Token" "TEST" 18 1000000000000000000000000 > ../../deployments/evm_token_deploy.txt
    EVM_TOKEN_ADDRESS=$(grep "Deployed to:" ../../deployments/evm_token_deploy.txt | awk '{print $3}')
    echo "EVM Token deployed at: $EVM_TOKEN_ADDRESS"
    cd ../..
fi

if [ "$DEPLOY_TYPE" == "all" ] || [ "$DEPLOY_TYPE" == "aztec" ]; then
    echo "Deploying Aztec Test Token..."
    cd packages/aztec/aztec_gateway_7683
    # Args: aztecSecretKey, aztecSalt, tokenName, tokenSymbol, tokenDecimals, rpcUrl
    # We capture stdout to file
    NODE_NO_WARNINGS=1 node --loader ts-node/esm scripts/deploy-token.ts         $AZTEC_SECRET_KEY         $AZTEC_SALT         "Test Token"         "TEST"         18         $AZTEC_RPC_URL > ../../../deployments/aztec_token_deploy.txt 2>&1

    # Read the file to find the address
    cat ../../../deployments/aztec_token_deploy.txt
    AZTEC_TOKEN_ADDRESS=$(grep "token deployed:" ../../../deployments/aztec_token_deploy.txt | awk '{print $NF}')
    echo "Aztec Token deployed at: $AZTEC_TOKEN_ADDRESS"
    cd ../../..
fi

echo ""
echo "---------------------------------------------------"
echo "Test Tokens Deployed Successfully!"
echo "---------------------------------------------------"
echo "Please add the following lines to your .env file:"
echo ""
if [ ! -z "$EVM_TOKEN_ADDRESS" ]; then
    echo "L2_EVM_TOKEN_ADDRESS=$EVM_TOKEN_ADDRESS"
fi
if [ ! -z "$AZTEC_TOKEN_ADDRESS" ]; then
    echo "AZTEC_TOKEN_ADDRESS=$AZTEC_TOKEN_ADDRESS"
fi
echo "RECIPIENT_ADDRESS=0x0000000000000000000000000000000000000001"
echo ""
echo "Then run the test_bridge script again."
