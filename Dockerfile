FROM oven/bun:1

WORKDIR /app

COPY package.json ./
COPY apps/game/server/package.json ./apps/game/server/package.json
COPY apps/game/shared-package/package.json ./apps/game/shared-package/package.json

RUN bun install

COPY apps/game/server ./apps/game/server
COPY apps/game/shared-package ./apps/game/shared-package

WORKDIR /app/apps/game/server

EXPOSE 4000

CMD ["bun", "--watch", "src/index.ts"]