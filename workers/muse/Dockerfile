# The Meta implementer's machine (workers/muse.ts): Muse Code and what a
# ticket needs to build, test and film. No key is ever in it: the Worker
# adds Meta's and GitHub's on the way out.
ARG SANDBOX_TOOLS_IMAGE=docker.io/cloudflare/sandbox:1.0.3
FROM ${SANDBOX_TOOLS_IMAGE} AS sandbox-tools

FROM node:22-bookworm

# Build tools, Python, and the recorder's desktop: the same packages as
# SANDBOX_PACKAGES in src/runner/anthropic.ts (tests/unit/muse.test.ts checks).
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    bash ca-certificates curl git ripgrep jq unzip zip \
    build-essential python3 python3-pip python3-venv \
    xvfb openbox xdotool wmctrl xterm x11-utils ffmpeg dmz-cursor-theme \
    fonts-inter fonts-jetbrains-mono fonts-dejavu-core \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable

# Meta's installer, into /usr/local/bin, with no update at run time.
ENV MUSE_NO_AUTO_UPDATE=1 MUSE_NO_MODIFY_PATH=1 MUSE_INSTALL_DIR=/usr/local/bin
RUN curl -fsSL https://dev.meta.ai/install.sh | bash && muse --version

COPY --from=sandbox-tools /usr/local/bin/sandbox-shim /usr/local/bin/sandbox-shim

WORKDIR /workspace
CMD ["sleep", "infinity"]
