# Stage 1: Install dependencies
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

# Stage 2: Build the app
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
# NEXT_PUBLIC_* vars are inlined into the client bundle at build time (not read at
# runtime), so the store domain used by the client-side Shopify checkout link must
# be present here. Passed via --build-arg by the deploy workflow; harmless if empty.
ARG NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN
ENV NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN=${NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN}
# auth-options.ts builds its NextAuth providers at module import, which "collecting
# page data" triggers — so these must EXIST during build, though their values are
# never used (every route is dynamic; real values come from ECS at runtime). Builder
# stage only; nothing here reaches the runner image.
ENV GOOGLE_CLIENT_ID=build-placeholder \
    GOOGLE_CLIENT_SECRET=build-placeholder \
    NEXTAUTH_SECRET=build-placeholder
RUN npm run build

# Stage 3: Production image
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/prisma ./prisma

EXPOSE 4000
ENV PORT=4000
CMD ["node", "server.js"]
