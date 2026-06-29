FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json tsconfig.json ./
COPY src ./src
COPY public ./public
COPY config.example.js ./
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node config.example.js ./
COPY --chown=node:node public ./public
COPY --chown=node:node --from=build /app/server ./server
COPY --chown=node:node --from=build /app/node_modules ./node_modules

RUN mkdir -p /app/data && chown -R node:node /app/data

USER node
EXPOSE 9528
VOLUME ["/app/data"]

CMD ["node", "server/index.js"]
