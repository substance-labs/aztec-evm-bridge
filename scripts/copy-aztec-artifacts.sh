#!/usr/bin/env bash
# Script to copy generated AztecGateway7683 artifacts to packages that need them

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

SOURCE_DIR="$ROOT_DIR/packages/aztec/aztec_gateway_7683/target"
SDK_DEST="$ROOT_DIR/packages/sdk/src/utils/artifacts/AztecGateway7683"
FILLER_DEST="$ROOT_DIR/packages/filler/src/artifacts/AztecGateway7683"

echo "Copying AztecGateway7683 artifacts..."

# Check if source files exist
if [ ! -f "$SOURCE_DIR/AztecGateway7683.ts" ]; then
  echo "Error: Source file $SOURCE_DIR/AztecGateway7683.ts not found."
  echo "Make sure to compile the aztec_gateway_7683 contract first."
  exit 1
fi

if [ ! -f "$SOURCE_DIR/aztec_gateway_7683-AztecGateway7683.json" ]; then
  echo "Error: Source file $SOURCE_DIR/aztec_gateway_7683-AztecGateway7683.json not found."
  echo "Make sure to compile the aztec_gateway_7683 contract first."
  exit 1
fi

# Create destination directories if they don't exist
mkdir -p "$SDK_DEST"
mkdir -p "$FILLER_DEST"

# Copy files to SDK
cp "$SOURCE_DIR/AztecGateway7683.ts" "$SDK_DEST/"
cp "$SOURCE_DIR/aztec_gateway_7683-AztecGateway7683.json" "$SDK_DEST/"

# Copy files to filler
cp "$SOURCE_DIR/AztecGateway7683.ts" "$FILLER_DEST/"
cp "$SOURCE_DIR/aztec_gateway_7683-AztecGateway7683.json" "$FILLER_DEST/"

echo "✓ Copied to $SDK_DEST"
echo "✓ Copied to $FILLER_DEST"

# Format the copied TypeScript files with prettier
echo "Formatting copied files with prettier..."
cd "$ROOT_DIR"
yarn prettier --write "$SDK_DEST/AztecGateway7683.ts" "$FILLER_DEST/AztecGateway7683.ts" 2>/dev/null || true

echo "✓ Artifacts copied and formatted successfully!"
