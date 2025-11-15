# マルチステージビルド - 本番環境用
FROM node:20-slim AS base

# 作業ディレクトリを設定
WORKDIR /app

# 依存関係のインストール用ステージ
FROM base AS deps
COPY package*.json ./
RUN npm ci --omit=dev && \
    npm cache clean --force

# ビルド用ステージ
FROM base AS build
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# 本番環境用ステージ
FROM base AS production

# 非rootユーザーを作成
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nodejs

# 必要なファイルをコピー
COPY --from=deps --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=build --chown=nodejs:nodejs /app/dist ./dist
COPY --from=build --chown=nodejs:nodejs /app/package*.json ./
COPY --from=build --chown=nodejs:nodejs /app/drizzle ./drizzle

# 環境変数（デフォルト値、実行時に上書き可能）
ENV NODE_ENV=production
ENV PORT=8080

# ユーザーを切り替え
USER nodejs

# ポートを公開
EXPOSE 8080

# ヘルスチェック
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:8080/', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# アプリケーション起動
CMD ["node", "dist/src/server.js"]
