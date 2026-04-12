FROM node:20-slim AS builder

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY packages/ingestion/package.json packages/ingestion/

RUN pnpm install --frozen-lockfile --filter @prontiq/ingestion...

COPY packages/shared/ packages/shared/
COPY packages/ingestion/ packages/ingestion/
COPY tsconfig.json ./

RUN pnpm --filter @prontiq/shared build && pnpm --filter @prontiq/ingestion build

# pnpm deploy creates a flat node_modules without workspace symlinks
RUN pnpm --filter @prontiq/ingestion deploy --prod /deploy

FROM node:20-slim

WORKDIR /app
COPY --from=builder /deploy/dist ./dist
COPY --from=builder /deploy/node_modules ./node_modules

ENV NODE_ENV=production
CMD ["node", "dist/fargate-bulk-ingest.js"]
