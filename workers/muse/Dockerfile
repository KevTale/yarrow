# The Meta implementer's machine (workers/muse.ts): Muse Code and what a
# ticket needs to build, test and film. No key is ever in it: the Worker
# adds Meta's and GitHub's on the way out. A pull request's stage
# (workers/stage.ts) runs on it too, its screen served by x11vnc and, as a
# WebSocket, by websockify.
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
    x11vnc websockify \
    fonts-inter fonts-jetbrains-mono fonts-dejavu-core \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable

# What Claude's sandbox already has and the rules promise (EVIDENCE_GUIDE in
# src/runner/prompts.ts): Chromium for the recorder, with its libraries,
# under /opt/pw-browsers, PostgreSQL 16 (PostgreSQL's own repository:
# Debian 12 has 15) and Redis 7. Without them Wonder installs them each run.
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers
RUN npm install -g playwright-core@1.63.0 \
  && playwright-core install --with-deps chromium \
  && install -d /usr/share/postgresql-common/pgdg \
  && curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
    https://www.postgresql.org/media/keys/ACCC4CF8.asc \
  && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" \
    > /etc/apt/sources.list.d/pgdg.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends postgresql-16 redis-server \
  && rm -rf /var/lib/apt/lists/*

# The code editor the demo and the stage show (src/runner/recorder/present.mjs),
# Gitpod's build of VS Code for a browser, without its language servers: it
# only shows code, and they took a machine's processor for seconds.
ADD https://github.com/gitpod-io/openvscode-server/releases/download/openvscode-server-v1.109.5/openvscode-server-v1.109.5-linux-x64.tar.gz /tmp/editor.tar.gz
RUN mkdir -p /opt/openvscode-server \
  && tar -xzf /tmp/editor.tar.gz -C /opt/openvscode-server --strip-components=1 \
  && rm -rf /tmp/editor.tar.gz /opt/openvscode-server/extensions/*-language-features

# Meta's installer, into /usr/local/bin, with no update at run time.
ENV MUSE_NO_AUTO_UPDATE=1 MUSE_NO_MODIFY_PATH=1 MUSE_INSTALL_DIR=/usr/local/bin
RUN curl -fsSL https://dev.meta.ai/install.sh | bash && muse --version

COPY --from=sandbox-tools /usr/local/bin/sandbox-shim /usr/local/bin/sandbox-shim

WORKDIR /workspace
CMD ["sleep", "infinity"]
