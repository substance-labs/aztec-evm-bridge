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

# Production stage
FROM node:20-alpine AS runner

WORKDIR /app

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
