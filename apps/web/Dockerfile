FROM oven/bun:1 AS build

WORKDIR /app

ENV NODE_ENV=production

COPY . .

RUN bun install --frozen-lockfile

WORKDIR /app/apps/web
RUN bun run build

# ---

FROM oven/bun:1 AS runtime
WORKDIR /app/apps/web
ENV NODE_ENV=production
ENV PORT=3000

COPY --from=build /app/apps/web/dist ./dist
COPY --from=build /app/apps/web/package.json ./package.json
COPY --from=build /app/package.json /app/bun.lock /app/

RUN bun install --frozen-lockfile --production

EXPOSE 3000

CMD ["bun", "run", "serve"]
