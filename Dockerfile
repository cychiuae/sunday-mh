# syntax=docker/dockerfile:1

# ---- build: install everything and bundle the client ----
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci
COPY shared shared
COPY client client
RUN npm run build

# ---- runtime: server deps only, plus the built client ----
FROM node:24-alpine
ENV NODE_ENV=production \
    PORT=2567
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --omit=dev --workspace server --include-workspace-root=false \
 && npm cache clean --force
COPY shared shared
COPY server/src server/src
COPY --from=build /app/client/dist client/dist

USER node
EXPOSE 2567
# The server is TypeScript; tsx (a server dependency) loads it under plain node.
CMD ["node", "--import", "tsx", "server/src/index.ts"]
