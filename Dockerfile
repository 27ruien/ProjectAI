ARG NODE_BASE_IMAGE=node:22-alpine@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2
FROM ${NODE_BASE_IMAGE} AS deps
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

FROM ${NODE_BASE_IMAGE} AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ARG NEXT_PUBLIC_BASE_PATH=/tool/projectai
ARG NEXT_PUBLIC_APP_ENV=production
ARG NEXT_PUBLIC_APP_VERSION=0.8.0-staging
ARG NEXT_PUBLIC_COMMIT_SHA=local
ARG NEXT_PUBLIC_BUILD_TIME=local
ENV NEXT_PUBLIC_BASE_PATH=${NEXT_PUBLIC_BASE_PATH}
ENV NEXT_PUBLIC_APP_ENV=${NEXT_PUBLIC_APP_ENV}
ENV NEXT_PUBLIC_APP_VERSION=${NEXT_PUBLIC_APP_VERSION}
ENV NEXT_PUBLIC_COMMIT_SHA=${NEXT_PUBLIC_COMMIT_SHA}
ENV NEXT_PUBLIC_BUILD_TIME=${NEXT_PUBLIC_BUILD_TIME}
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build

FROM ${NODE_BASE_IMAGE} AS runner
WORKDIR /app

ARG NEXT_PUBLIC_BASE_PATH=/tool/projectai
ARG NEXT_PUBLIC_APP_ENV=production
ARG NEXT_PUBLIC_APP_VERSION=0.8.0-staging
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

COPY --from=builder --chown=node:node /app/dist/standalone/ ./
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json tsconfig.json ./
COPY --chown=node:node lib ./lib
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node tests/fixtures/hybrid-retrieval-evaluation.json ./tests/fixtures/hybrid-retrieval-evaluation.json
COPY --chown=node:node types ./types
RUN install -d -o node -g node /app/review-artifacts

# The protected Staging Secret is owned by deploy:deploy (UID/GID 1000) with
# mode 0600. Keep the runtime non-root while matching that numeric identity so
# the App can read its App-only, read-only Compose Secret bind mount.
USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --retries=5 --start-period=30s \
  CMD node -e "const base=(process.env.NEXT_PUBLIC_BASE_PATH||'').replace(/\/$/,'');const url='http://127.0.0.1:'+(process.env.PORT||'3000')+base+'/api/health';fetch(url).then(async r=>{if(!r.ok||(await r.json()).status!=='ok')process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
