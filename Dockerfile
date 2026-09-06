FROM node:22-alpine

WORKDIR /app

COPY server/package.json ./server/package.json
COPY server ./server
COPY public ./public
COPY admin ./admin

# No npm install needed — the server has zero external dependencies by
# design, so there's nothing to fetch and no lockfile drift to worry about.

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# SERAPH_ADMIN_PASSWORD must be supplied at runtime (see docker-compose.yml
# / .env). The server refuses admin logins until it is set.

WORKDIR /app/server
CMD ["node", "server.js"]
