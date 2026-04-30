FROM oven/bun:1

WORKDIR /app

COPY shared-package/ ./shared-package/
COPY server/ ./server/

WORKDIR /app/server

RUN bun install

EXPOSE 4000

CMD ["bun", "--watch", "src/index.ts"]