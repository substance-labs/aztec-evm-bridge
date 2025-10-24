# Filler

## �� Installation

Clone the repository and install dependencies:

```bash
git clone https://github.com/substance-labs/aztec-evm-bridge
cd aztec-evm-bridge/packages/filler
nvm use
yarn install
```

Copy the sample environment file and set the required values:

```bash
cp .env.example .env
# edit .env before running the filler
```

## 🚀 Development

To start the dev server with hot reload:

```bash
yarn dev
```

## 🧱 Build

To compile the TypeScript source into `dist/`:

```bash
yarn build
```

Start the compiled version with:

```bash
yarn start
```

For operational walkthroughs and troubleshooting tips, refer to [`docs/running-the-filler.md`](docs/running-the-filler.md).
