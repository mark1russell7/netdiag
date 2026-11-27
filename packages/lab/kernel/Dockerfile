# The netdiag image of the kernel lab (ND-7, step 3). The harness builds it from the root of the repository with the
# files of `IMAGE_FILES` (packages/lab/src/kernel/world.ts). The client of the lab, the reference host and the
# resolver use it. The target uses the base image with no change.
#
# The base is pinned by digest. The harness refuses a base that is not.
FROM node:26.13.1-trixie-slim@sha256:abe7e5a82b61a8ef67b315b85497c9e65173387ccf2f4a029248184b8e020be5

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
