# ─── Build stage ──────────────────────────────────
FROM node:20-alpine AS build

ARG PORT=3000

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# ─── Runtime stage ────────────────────────────────
FROM node:20-alpine

ARG PORT=3000
ENV PORT=$PORT
ENV NODE_ENV=production

# PORT 기본값은 src/config.ts 의 DEFAULT_PORT(=3000)와 동기화.
# 변경 시 두 파일을 함께 수정.

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist/ ./dist/

USER node
# EXPOSE는 반드시 숫자여야 함. PORT 기본값(3000) 유지.
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:${PORT}/health || exit 1

CMD ["node", "dist/index.js"]
