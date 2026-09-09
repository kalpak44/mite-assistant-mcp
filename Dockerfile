# Alpine, not Debian: perl-base and glibc carry wont-fix CVEs a pure-JS app never calls,
# so every Debian base bottoms out at 7 Criticals. This one scans 0 Critical / 0 High.
# Node major is pinned here, in publish.yml's node-version, and in package.json engines.
# Move all three together. See .claude/rules/github-repos.md in homelab-infra.
FROM node:24-alpine

# The Node base lags Alpine on OpenSSL: libssl3 and libcrypto3 were all 18 Critical/High
# on 2026-09-09. Not a no-op here, unlike on the kubectl-awscli images.
RUN apk upgrade --no-cache

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

COPY package.json package-lock.json ./

# npm goes once it has installed: its vendored tree was 19 Critical/High that no change
# to this lockfile can reach, and the runtime command never uses npm.
RUN npm ci --omit=dev && npm cache clean --force \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

COPY src ./src

EXPOSE 3000

USER node

CMD ["node", "src/server.js"]
