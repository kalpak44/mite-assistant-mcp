# Alpine, not bookworm-slim. Measured 2026-09-09 with syft 1.51.1 + grype 0.118.0 on
# linux/amd64, same database for every row:
#
#   node:20-bookworm-slim 10 Critical / 95 High, 293 findings — and Node 20 is EOL
#   node:22-bookworm-slim 8 Critical / 61 High, 230 findings
#   node:24-trixie-slim 7 Critical / 61 High, 171 findings
#   node:24-alpine 4 Critical / 14 High, 23 findings
#   node:24-alpine plus the two steps below 0 Critical / 0 High, 3 findings
#
# The Debian variants bottom out at 7 Criticals whichever release they track, because
# perl-base and glibc carry wont-fix CVEs and sit in the base whether the app touches them
# or not. This app is pure JavaScript with no native modules, so musl costs nothing.
#
# Node 24 is Active LTS. Node 24 and 26 publish no linux/arm/v7, which is why publish.yml
# builds linux/amd64 alone — the cluster is x86 and no ARM consumer exists.
#
# The Node major is pinned in three places and moves in all three together: this line,
# publish.yml's `node-version`, and package.json's `engines`. dependabot.yml holds the
# `node` bump so the three cannot drift one PR at a time.
FROM node:24-alpine

# The base ships OpenSSL one patch behind, and that alone was the whole Critical/High
# surface: libssl3 and libcrypto3 at 3.5.7-r0 produced all 18 findings of the
# node:24-alpine row above, every one fixed in 3.5.8-r0.
#
# This is deliberately NOT the no-op that `apk upgrade` is on the kubectl-awscli and
# postgres-awscli images, measured there on 2026-08-24 as identical counts with and
# without. Those install their own apk packages unversioned and so already resolve
# current; this image inherits OpenSSL from a Node base rebuilt on Node's schedule
# rather than Alpine's, so it lags between Node releases.
RUN apk upgrade --no-cache

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

COPY package.json package-lock.json ./

# npm is deleted once it has done its job. Nothing at runtime uses it — the command is
# `node src/server.js` — and its own vendored dependency tree accounted for 19 of the
# image's Critical/High findings: tar, pacote, sigstore, minimatch, glob, brace-expansion
# and cross-spawn, all under /usr/local/lib/node_modules/npm and none of them reachable
# from this project's lockfile. Removing it is the only way to fix them.
RUN npm ci --omit=dev && npm cache clean --force \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

COPY src ./src

EXPOSE 3000

USER node

CMD ["node", "src/server.js"]
