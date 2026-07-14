FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# Database operations run in a short-lived, explicitly invoked container. This
# target intentionally keeps the repository migrations and CLI dependencies out
# of the minimal application runtime image.
FROM deps AS db-tools
WORKDIR /app
COPY . .
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
USER node

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ARG NEXT_PUBLIC_BASE_PATH=/tool/projectai
ARG NEXT_PUBLIC_APP_ENV=production
ARG NEXT_PUBLIC_APP_VERSION=0.3.0-staging
ARG NEXT_PUBLIC_COMMIT_SHA=local
ARG NEXT_PUBLIC_BUILD_TIME=local
ENV NEXT_PUBLIC_BASE_PATH=${NEXT_PUBLIC_BASE_PATH}
ENV NEXT_PUBLIC_APP_ENV=${NEXT_PUBLIC_APP_ENV}
ENV NEXT_PUBLIC_APP_VERSION=${NEXT_PUBLIC_APP_VERSION}
ENV NEXT_PUBLIC_COMMIT_SHA=${NEXT_PUBLIC_COMMIT_SHA}
ENV NEXT_PUBLIC_BUILD_TIME=${NEXT_PUBLIC_BUILD_TIME}
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app

ARG NEXT_PUBLIC_BASE_PATH=/tool/projectai
ARG NEXT_PUBLIC_APP_ENV=production
ARG NEXT_PUBLIC_APP_VERSION=0.3.0-staging
ARG NEXT_PUBLIC_COMMIT_SHA=local
ARG NEXT_PUBLIC_BUILD_TIME=local

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOST=0.0.0.0
ENV NEXT_PUBLIC_BASE_PATH=${NEXT_PUBLIC_BASE_PATH}
ENV NEXT_PUBLIC_APP_ENV=${NEXT_PUBLIC_APP_ENV}
ENV NEXT_PUBLIC_APP_VERSION=${NEXT_PUBLIC_APP_VERSION}
ENV NEXT_PUBLIC_COMMIT_SHA=${NEXT_PUBLIC_COMMIT_SHA}
ENV NEXT_PUBLIC_BUILD_TIME=${NEXT_PUBLIC_BUILD_TIME}

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 --ingroup nodejs nextjs

COPY --from=builder --chown=nextjs:nodejs /app/dist/standalone/ ./

USER nextjs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --retries=5 --start-period=30s \
  CMD node -e "const base=(process.env.NEXT_PUBLIC_BASE_PATH||'').replace(/\/$/,'');const url='http://127.0.0.1:'+(process.env.PORT||'3000')+base+'/api/health';fetch(url).then(async r=>{if(!r.ok||(await r.json()).status!=='ok')process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
