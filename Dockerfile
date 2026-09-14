# ── Stage 1: Dependencies ──
FROM node:20-alpine AS deps
WORKDIR /app

# Install Python for Fernet decryption
RUN apk add --no-cache python3 py3-pip
RUN pip3 install cryptography --break-system-packages

COPY package.json package-lock.json ./
RUN npm ci --only=production

# ── Stage 2: Build ──
FROM node:20-alpine AS builder
WORKDIR /app

RUN apk add --no-cache python3 py3-pip
RUN pip3 install cryptography --break-system-packages

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Build the Next.js application
RUN npm run build

# ── Stage 3: Production ──
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Install Python for Fernet decryption at runtime
RUN apk add --no-cache python3 py3-pip
RUN pip3 install cryptography --break-system-packages

# Create non-root user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy necessary files
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# Copy config and encryption files
COPY config.json ./
COPY .env ./
COPY scripts/.encryption_key ./scripts/.encryption_key
COPY messages ./messages

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
