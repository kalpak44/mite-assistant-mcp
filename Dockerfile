# Alpine, not Debian: the Debian bases carry unfixable CVEs in packages a pure-JavaScript
# app never calls. No native modules here, so musl costs nothing.
#
# The Node major is pinned in three places — this line, publish.yml's node-version, and
# package.json engines. Move all three together.
FROM node:24-alpine

# The Node base ships an older OpenSSL than Alpine has packaged, so start from current
# packages rather than whenever the base was last rebuilt. The version constraint is what
# makes that hold: the gha layer cache would otherwise serve this step from an earlier
# build for ever, and the upgrade would never reach a published image. CVE-2026-85091.
RUN apk upgrade --no-cache \
 && apk add --no-cache 'zlib>=1.3.2-r1'

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

COPY package.json package-lock.json ./

# npm is needed to install and never at runtime. Deleting it takes its whole vendored
# dependency tree — which this lockfile cannot influence — out of the shipped image.
RUN npm ci --omit=dev && npm cache clean --force \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

COPY src ./src

EXPOSE 3000

USER node

CMD ["node", "src/server.js"]
