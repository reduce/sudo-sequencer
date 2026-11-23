# Sudo Sequencer: the static app plus the Express server that holds Jev's key. Alpine throughout.
# The key is never built in: it arrives as an environment variable at run time (Coolify, compose).

# ---- assets: the CC0 avatars and MIT dance clips are not all in git, so fetch them here ----
FROM alpine:3.22 AS assets
RUN apk add --no-cache bash curl
WORKDIR /src
COPY scripts/fetch-assets.sh scripts/
COPY assets assets
RUN bash scripts/fetch-assets.sh

# ---- build: minified, content-hashed scripts and stylesheet (esbuild) ----
FROM node:22-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY index.html ./
COPY css ./css
COPY js ./js
COPY scripts/build.mjs scripts/
RUN node scripts/build.mjs

# ---- app ----
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

COPY server ./server
# the server reads the engine's catalog (styles, sounds) from genome.js to build Jev's questions
COPY js/genome.js ./js/genome.js
COPY --from=build /src/dist ./dist
COPY --from=assets /src/assets ./assets

USER node
ENV PORT=4173
EXPOSE 4173
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4173)+'/api/jev').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.js"]
