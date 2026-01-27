# Build stage
FROM node:20-alpine AS builder

# Install pnpm
RUN npm install -g pnpm

WORKDIR /app

# Copy workspace configuration
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/core/package.json ./packages/core/
COPY packages/dsl/package.json ./packages/dsl/
COPY packages/store/package.json ./packages/store/
COPY packages/engine/package.json ./packages/engine/
COPY packages/ordering/package.json ./packages/ordering/
COPY packages/net/package.json ./packages/net/
COPY packages/node/package.json ./packages/node/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY . .

# Build all packages
RUN pnpm build

# Runtime stage
FROM node:20-alpine

WORKDIR /app

# Copy built artifacts and necessary files
COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages

# Set environment
ENV NODE_ENV=production
ENV PATH="/app/packages/node/dist:${PATH}"

# Expose VERA P2P/API port
EXPOSE 5001

# Default data directory
VOLUME /data

# Default command
ENTRYPOINT ["node", "/app/packages/node/dist/cli.js"]
CMD ["run", "--data", "/data"]
