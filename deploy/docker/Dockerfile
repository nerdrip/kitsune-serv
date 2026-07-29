FROM node:24-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl procps tar unzip xz-utils \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/kitsuneserv
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src
COPY config/downloads.json config/instances.json ./config/
COPY www/index.html ./www/index.html
COPY utils/adminer ./utils/adminer
COPY LICENSE README.md SERVICES.md ./

ENV KITSUNE_HOST=0.0.0.0 \
    KITSUNE_PORT=10000 \
    KITSUNE_DATA_DIR=/data \
    KITSUNE_DISABLE_SYSTEM_INTEGRATION=1 \
    NODE_ENV=production

VOLUME ["/data"]
EXPOSE 10000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -fsS http://127.0.0.1:10000/ >/dev/null || exit 1

CMD ["node", "src/server.js"]
