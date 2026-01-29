# @substancelabs/filler

Order filling service for the Aztec-EVM Bridge.

The filler monitors cross-chain orders and fulfills them by providing liquidity on destination chains.

## Quick Start

```bash
# Install dependencies
yarn install

# Copy environment template
cp .env.example .env

# Start development server
yarn dev
```

## Scripts

| Command | Description |
| ------- | ----------- |
| `yarn dev` | Start with hot reload |
| `yarn build` | Build for production |
| `yarn start` | Run production build |
| `yarn test` | Run unit tests |
| `yarn test:coverage` | Run tests with coverage |
| `yarn mongo:start` | Start local MongoDB |
| `yarn mongo:stop` | Stop local MongoDB |

## Docker

Run with Docker Compose:

```bash
docker compose up -d
```

See logs:

```bash
docker compose logs -f filler
```

Stop:

```bash
docker compose down
```

## Configuration

The filler requires:

- MongoDB for state persistence
- EVM RPC endpoints (Base Sepolia, Ethereum Sepolia)
- Aztec RPC endpoint
- Funded accounts on both chains

See the [Filler Guide](../../docs/filler.md) for complete configuration options.

## Documentation

- [Full Filler Guide](../../docs/filler.md)
- [Deployment Guide](../../docs/deployment.md)
