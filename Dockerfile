# Stage 1: Install dependencies
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

# Stage 2: Build the app
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
# NEXT_PUBLIC_* vars are inlined into the client bundle at build time (not read at
# runtime), so the store domain used by the client-side Shopify checkout link must
# be present here. Passed via --build-arg by the deploy workflow; harmless if empty.
ARG NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN
ENV NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN=${NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN}
# Build stamp surfaced in the app footer: the deployed commit SHA, passed via
# --build-arg by the deploy workflow and inlined into the bundle (NEXT_PUBLIC_*,
# build-time). Empty in local/ad-hoc builds -> the footer shows "dev".
ARG NEXT_PUBLIC_GIT_SHA
ENV NEXT_PUBLIC_GIT_SHA=${NEXT_PUBLIC_GIT_SHA}
# Needed for GitHub to build the image, overwritten by secrets in AWS at run time.
# (next build imports auth-options.ts, which requires these to exist; the values
# are never used — every route is dynamic — and never reach the runner stage.)
ENV GOOGLE_CLIENT_ID=build-placeholder \
    GOOGLE_CLIENT_SECRET=build-placeholder \
    NEXTAUTH_SECRET=build-placeholder
RUN npm run build

# Stage 3: Production image
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# RDS TLS: the pg driver verifies the server certificate (sslmode=require is
# strict in the Prisma 7 / pg stack), and Amazon's RDS CA is not in the OS
# trust store — without this, every query dies with "unable to get local
# issuer certificate". NODE_EXTRA_CA_CERTS appends to Node's default roots.
ADD https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /app/rds-global-bundle.pem
ENV NODE_EXTRA_CA_CERTS=/app/rds-global-bundle.pem

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
# The Rust-free `prisma-client` generator emits the client into src/generated/prisma,
# which Next's standalone output tracing bundles automatically — there is no
# node_modules/.prisma engine directory to copy as there was with prisma-client-js.
COPY --from=builder /app/prisma ./prisma
# Prisma 7 only reads the datasource URL from a config file (schema-level `url`
# was removed), so the migrate ECS task — `npx prisma migrate deploy` in this
# image — needs one. The repo's prisma.config.ts can't be shipped: its dotenv /
# prisma/config imports don't resolve here. The deploy variant has no imports.
COPY --from=builder /app/prisma.config.deploy.ts ./prisma.config.ts

EXPOSE 4000
ENV PORT=4000
CMD ["node", "server.js"]
