# syntax=docker/dockerfile:1

# Base image is parameterised so it can be swapped for a private mirror or a
# pre-pulled tag in networks where Docker Hub is not reachable:
#   docker build --build-arg NODE_IMAGE=my-registry/node:22-alpine .
ARG NODE_IMAGE=node:22-alpine

# --- Build stage ---
FROM ${NODE_IMAGE} AS build
WORKDIR /app

# Install all workspace dependencies (root + server + web) with a cached layer.
COPY package.json package-lock.json* ./
COPY server/package.json ./server/
COPY web/package.json ./web/
RUN npm ci

# Build server and web, then drop dev dependencies.
COPY . .
RUN npm run build && npm prune --omit=dev

# --- Runtime stage ---
FROM ${NODE_IMAGE} AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=4321 \
    LIBRARY_DIR=/library \
    DATA_DIR=/data

# Run as an unprivileged user; /data is a managed volume owned by that user.
RUN mkdir -p /data /library \
    && addgroup -S app && adduser -S app -G app \
    && chown -R app:app /app /data

COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/package.json ./package.json
COPY --from=build --chown=app:app /app/server/package.json ./server/package.json
COPY --from=build --chown=app:app /app/server/dist ./server/dist
COPY --from=build --chown=app:app /app/web/dist ./web/dist

USER app
VOLUME ["/data"]
EXPOSE 4321

# Liveness probe against the unauthenticated /healthz endpoint.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4321)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--experimental-sqlite", "--disable-warning=ExperimentalWarning", "server/dist/index.js", "serve"]
