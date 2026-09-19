# ── Stage 1: build ──
FROM node:22-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
# The app has no public/ folder; the runner stage copies one, so make sure it exists.
RUN mkdir -p public && npm run build

# ── Stage 2: run ──
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=5005 \
    HOSTNAME=0.0.0.0 \
    TZ=Asia/Ho_Chi_Minh

# The app decrypts its Fernet-encrypted .env secrets by shelling out to
# `python -c "from cryptography.fernet import Fernet ..."` — it needs a
# `python` binary (Alpine only ships python3) with `cryptography`.
RUN apk add --no-cache python3 py3-cryptography tzdata \
    && ln -sf /usr/bin/python3 /usr/bin/python

RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# Files the app reads from its working directory at runtime (hierarchy /
# promotion imports) and the daily-sync script used by the optional
# "daily-sync" compose service.
COPY --chown=nextjs:nodejs itemgroup.json custgroup.json ./
COPY --chown=nextjs:nodejs SAP_Item_Group.xlsx SAP_Customer_Group.xlsx GT_Promotion_Detail.xlsx ./
COPY --chown=nextjs:nodejs scripts/daily-sync.mjs ./scripts/daily-sync.mjs

# config.json, .env and scripts/.encryption_key hold secrets: they are NOT
# baked into the image — docker-compose.yml mounts them read-only.

USER nextjs
EXPOSE 5005

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:5005/api/app-info').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
