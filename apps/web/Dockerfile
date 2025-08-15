FROM oven/bun:1 AS base

WORKDIR /code

ENV NODE_ENV=production

COPY package.json bun.lock ./
COPY apps/web/package.json ./apps/web/package.json

RUN bun install

COPY . .

RUN bun run build

CMD ["bun", "start"]