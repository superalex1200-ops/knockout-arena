FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/server/package.json apps/server/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --frozen-lockfile --filter @knockout/server...
COPY apps/server apps/server
COPY packages/shared packages/shared
RUN pnpm --filter @knockout/server build

FROM node:24-alpine
RUN corepack enable
WORKDIR /app
ENV NODE_ENV=production PORT=2567
COPY --from=build /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=build /app/apps/server/package.json apps/server/package.json
COPY --from=build /app/packages/shared/package.json packages/shared/package.json
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/apps/server/node_modules apps/server/node_modules
COPY --from=build /app/apps/server/dist apps/server/dist
EXPOSE 2567
CMD ["node", "apps/server/dist/index.js"]
