# The netdiag image of the kernel lab (ND-7, step 3). The harness builds it from the root of the repository with the
# files of `IMAGE_FILES` (packages/lab/src/kernel/world.ts). The client of the lab, the reference host and the
# resolver use it. The target uses the base image with no change.
#
# The base is pinned by digest. The harness refuses a base that is not.
FROM node:24.22.3-trixie-slim@sha256:4d00acb4bcc42c454c4eb801526f7ad7f772ea3bd4fd168c5cc2e384abcbb9d4

# The tools of the visit: ping of iputils, mtr, Modern traceroute and ip.
RUN apt-get update \
  && apt-get install -y --no-install-recommends iputils-ping mtr-tiny traceroute iproute2 \
  && rm -rf /var/lib/apt/lists/*

# The version of pnpm is the version of the field packageManager of the root package.json.
RUN npm install --global pnpm@12.20.0

WORKDIR /lab

# The manifests first: a change of a source then keeps the layer of the install.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/fixtures/package.json packages/fixtures/
COPY packages/lab/package.json packages/lab/
COPY packages/netdiag/package.json packages/netdiag/
COPY packages/site/package.json packages/site/
RUN pnpm install --frozen-lockfile --prod --filter "@netdiag/lab..."

COPY packages/fixtures/src packages/fixtures/src
COPY packages/netdiag/src packages/netdiag/src
COPY packages/lab/src packages/lab/src

CMD ["node", "packages/lab/src/kernel/agent.ts"]
