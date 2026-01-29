# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Enable Corepack for Yarn
RUN corepack enable

# Copy root configuration files
COPY package.json yarn.lock .yarnrc.yml ./
COPY .yarn ./.yarn

# Copy all packages source code
# This is necessary because local dependencies might be referenced, 
# and Yarn workspaces need to resolve all package.json files.
COPY packages ./packages

# Install dependencies
RUN yarn install --immutable

# Build the filler package
WORKDIR /app/packages/filler
RUN yarn build

# Aztec image stage - copy bb binary from official Aztec image
FROM aztecprotocol/aztec:3.0.0-devnet.6-patch.1 AS aztec

# Production stage - use Ubuntu 24.04 for GLIBCXX_3.4.32 compatibility
FROM ubuntu:24.04 AS runner

WORKDIR /app

# Install Node.js 22 and required dependencies
RUN apt-get update && apt-get install -y \
    curl \
    ca-certificates \
    gnupg \
    && mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
    && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" | tee /etc/apt/sources.list.d/nodesource.list \
    && apt-get update \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Copy bb binary from the Aztec image
COPY --from=aztec /usr/src/bb /usr/local/bin/bb
ENV PATH="/usr/local/bin:${PATH}"

# Enable Corepack
RUN corepack enable

# Copy root configuration files
COPY package.json yarn.lock .yarnrc.yml ./
COPY .yarn ./.yarn

# Copy node_modules from builder (includes all dependencies)
COPY --from=builder /app/node_modules ./node_modules

# Copy the built filler package
COPY --from=builder /app/packages/filler/package.json ./packages/filler/package.json
COPY --from=builder /app/packages/filler/dist ./packages/filler/dist

# Set working directory to the filler package
WORKDIR /app/packages/filler

# Expose any necessary ports (optional, but good practice if known)
# EXPOSE 3000

# Start the application
CMD ["yarn", "start"]
