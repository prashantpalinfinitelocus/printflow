# PrintFlow web — Next.js 15 App Router.
#
# Multi-stage: the build stage needs the full dependency tree, the runtime stage
# only needs Next's standalone output (see `output: "standalone"` in
# next.config.ts), which keeps the final image small.

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci


FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# API_BASE_URL is deliberately not set here. It is read at runtime by
# lib/session.ts (server-only), so one image works against any API address.
RUN npm run build


FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Run as the image's built-in unprivileged user rather than root.
USER node

COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static

EXPOSE 3000

CMD ["node", "server.js"]
