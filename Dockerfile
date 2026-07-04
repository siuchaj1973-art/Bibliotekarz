# --- Build stage ---
FROM node:22-alpine AS build
WORKDIR /app

# Install all workspace dependencies (root + server + web).
COPY package.json package-lock.json* ./
COPY server/package.json ./server/
COPY web/package.json ./web/
RUN npm install

# Build server and web.
COPY . .
RUN npm run build

# Prune to production dependencies only.
RUN npm prune --omit=dev

# --- Runtime stage ---
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=4321 \
    LIBRARY_DIR=/library \
    DATA_DIR=/data

# Copy production node_modules and built artifacts.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/server/package.json ./server/package.json
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/web/dist ./web/dist

VOLUME ["/data"]
EXPOSE 4321

CMD ["node", "--experimental-sqlite", "--disable-warning=ExperimentalWarning", "server/dist/index.js", "serve"]
