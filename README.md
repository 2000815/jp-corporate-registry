<div align="center">

# 🏢 国税庁法人情報検索API

[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](https://opensource.org/licenses/ISC)
[![Node.js](https://img.shields.io/badge/Node.js-20.x-green.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue.svg)](https://www.typescriptlang.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-14+-316192.svg)](https://www.postgresql.org/)

**高速で柔軟な企業情報検索APIを、わずか5分で構築**

国税庁の法人情報をローカルDBに同期し、瞬時に企業名検索できるREST APIです。

[クイックスタート](#-クイックスタート-5分で起動) | [API仕様](#-api仕様) | [デプロイ](#-デプロイ)

</div>

---

## ✨ 特徴

| 特徴 | 説明 |
|------|------|
| ⚡ **高速検索** | PostgreSQL / BigQueryでミリ秒単位のレスポンス |
| 🐳 **即座に起動** | Docker Composeで環境構築不要、`npm run setup`で完了 |
| 📚 **完全なAPI仕様** | Swagger UIで対話的にAPIをテスト可能 |
| 🔒 **型安全** | TypeScript + Drizzle ORMで保守性の高いコード |
| ☁️ **柔軟なデプロイ** | Docker / ローカル / Google Cloud Run対応 |
| 🎯 **部分一致検索** | 企業名の前方・部分一致に対応、使いやすいAPI設計 |
| 🌐 **BigQuery対応** | PostgreSQLとBigQueryの両方に対応、用途に応じて選択可能 |

## 🎯 このプロジェクトが解決する課題

- **レスポンス速度**: 国税庁APIの代わりにローカルDBを使用し、検索速度を大幅に向上
- **データ統合**: 複数の企業情報を組み合わせたアプリケーション開発が容易に
- **リクエスト制限**: 外部APIの制限を気にせず大量のクエリ処理が可能
- **可用性**: ネットワーク障害時でもローカルデータで動作継続

## 🛠️ 技術スタック

<table>
<tr>
<td>

**Backend**
- TypeScript 5.3
- h3 (Web Framework)
- Drizzle ORM

</td>
<td>

**Database**
- PostgreSQL 14+ / BigQuery
- インデックス最適化済み
- 両方のDBに対応

</td>
<td>

**Infrastructure**
- Docker & Docker Compose
- Google Cloud Run対応
- npm scripts自動化

</td>
</tr>
</table>

## 🚀 クイックスタート (5分で起動)

### 前提条件

- [Node.js](https://nodejs.org/) 20.x+
- [Docker](https://www.docker.com/) & Docker Compose
- npm (Node.js同梱)

### 🐳 Dockerで起動（推奨）

```bash
# 1️⃣ リポジトリをクローン
git clone <repository-url>
cd jp-corporate-registry

# 2️⃣ 環境変数の設定（必要に応じて編集）
cp .env.example .env

# 3️⃣ Docker DB起動 + 依存関係インストール + マイグレーション
npm run setup

# 4️⃣ APIサーバーを起動
npm run dev

# 5️⃣ データインポート（オプション）
# 国税庁CSVファイルを data/corporation_data.csv に配置してから実行
npm run import

# ✅ 完了！以下でアクセス可能
# API: http://localhost:3000
# Swagger UI: http://localhost:3000/api-docs
```

**クイックセットアップ（全自動）:**

```bash
npm run setup:full  # セットアップ + データインポート
npm run dev         # APIサーバー起動
```

### 📝 よく使うnpmコマンド

| コマンド | 説明 |
|---------|------|
| `npm run docker:up` | Dockerコンテナ起動（DBのみ） |
| `npm run docker:down` | Dockerコンテナ停止 |
| `npm run docker:logs` | ログをリアルタイム表示 |
| `npm run docker:ps` | コンテナ状態確認 |
| `npm run docker:clean` | 完全クリーンアップ（ボリューム削除） |
| `npm run dev` | APIサーバー起動（開発モード） |
| `npm run db:migrate` | マイグレーション実行 |
| `npm run db:studio` | Drizzle Studio起動（DB GUI） |
| `npm run import` | データインポート |
| `npm run setup` | 初回セットアップ |
| `npm run setup:full` | 初回セットアップ + データインポート |

> 💡 **詳細設定**: [Docker環境ガイド](./docs/DOCKER.md) を参照してください。

## 💻 ローカル環境（Docker未使用）

### 前提条件

- Node.js 20.x+
- PostgreSQL 14.x+
- npm または pnpm

### セットアップ手順

```bash
# 1. 依存関係をインストール
npm install

# 2. PostgreSQLでDBを作成
createdb corporations_db

# 3. 環境変数を設定
cp .env.example .env
# .env を編集してDB接続情報を設定

# 4. マイグレーション実行
npm run db:migrate

# 5. データインポート（オプション）
# 国税庁CSVを data/ に配置してから
npm run import

# 6. 開発サーバー起動
npm run dev

# ✅ http://localhost:3000 で起動
```

### 本番ビルド

```bash
npm run build
npm start
```

## ⚙️ 環境変数

`.env` ファイルで以下の変数を設定：

| 変数名 | 説明 | デフォルト値 | 必須 |
|--------|------|-------------|------|
| `DATABASE_URL` | PostgreSQL接続URL | `postgresql://user:pass@localhost:5432/db` | ✅ |
| `PORT` | APIサーバーのポート | `3000` | ❌ |
| `BATCH_SIZE` | データインポート時のバッチサイズ | `1000` | ❌ |

**例: `.env`**

```env
DATABASE_URL=postgresql://postgres:password@localhost:5432/corporations_db
PORT=3000
BATCH_SIZE=1000
```

## 🌐 BigQueryへの移行

PostgreSQLの代わりにBigQueryを使用することもできます。

### BigQuery使用のメリット

| 項目 | PostgreSQL | BigQuery |
|------|-----------|----------|
| **スケーラビリティ** | 垂直スケーリング | 自動・無制限 |
| **管理負担** | サーバー管理必要 | フルマネージド |
| **同時接続** | 制限あり | 実質無制限 |
| **コスト** | サーバー費用（固定） | クエリ従量課金 |
| **初期セットアップ** | 簡単 | やや複雑 |

### セットアップ手順

```bash
# 1. BigQuery APIを有効化
gcloud services enable bigquery.googleapis.com

# 2. サービスアカウントキーを作成
gcloud iam service-accounts keys create ./bigquery-key.json \
  --iam-account=your-service-account@project.iam.gserviceaccount.com

# 3. 環境変数を設定
cp .env.example .env
# .envにBigQuery設定を追加
```

**BigQuery用環境変数**:

```env
BIGQUERY_PROJECT_ID=your-gcp-project-id
BIGQUERY_DATASET_ID=corporations
BIGQUERY_TABLE_ID=corporations
BIGQUERY_KEY_FILE=./bigquery-key.json
PORT=3000
```

### APIルートの切り替え

`src/server.ts`を編集：

```typescript
// PostgreSQL版
import search from './routes/search.js';

// BigQuery版に切り替え
import search from './routes/search-bigquery.js';
```

> 📖 **詳細手順**: [BigQueryセットアップガイド](./docs/BIGQUERY_SETUP.md) を参照

## 📡 API仕様

### 🎨 Swagger UIで試す

インタラクティブなAPI仕様書でリアルタイムにテスト：

- **Swagger UI**: http://localhost:3000/api-docs

### 🔍 企業名検索 API

**エンドポイント**

```http
GET /search?name={企業名}
```

**パラメータ**

| パラメータ | 型 | 必須 | 説明 |
|-----------|-------|------|------|
| `name` | string | ✅ | 検索する企業名（部分一致） |

**実行例**

```bash
# 基本的な検索
curl "http://localhost:3000/search?name=トヨタ"

# URLエンコードが必要な場合
curl "http://localhost:3000/search?name=%E3%83%88%E3%83%A8%E3%82%BF"

# jqで整形して表示
curl "http://localhost:3000/search?name=ソニー" | jq
```

**レスポンス例**

<details>
<summary><b>✅ 成功（200 OK）</b></summary>

```json
{
  "count": 2,
  "data": [
    {
      "corporate_number": "1010001000001",
      "name": "株式会社テスト",
      "prefecture_name": "東京都",
      "city_name": "千代田区",
      "street_number": "丸の内1-1-1"
    },
    {
      "corporate_number": "1010001000002",
      "name": "テスト工業株式会社",
      "prefecture_name": "東京都",
      "city_name": "新宿区",
      "street_number": "西新宿2-8-1"
    }
  ]
}
```
</details>

<details>
<summary><b>📭 検索結果なし（200 OK）</b></summary>

```json
{
  "count": 0,
  "data": []
}
```
</details>

<details>
<summary><b>❌ エラー（400 Bad Request）</b></summary>

```json
{
  "error": "検索する企業名（name）を指定してください。"
}
```
</details>

### 📊 レスポンスフィールド

| フィールド | 型 | 説明 |
|-----------|-------|------|
| `corporate_number` | string | 法人番号（13桁） |
| `name` | string | 法人名 |
| `prefecture_name` | string | 都道府県名 |
| `city_name` | string | 市区町村名 |
| `street_number` | string | 丁目番地等 |

## ☁️ デプロイ

### Google Cloud Run

本番環境として、サーバーレスでスケーラブルなCloud Runにデプロイ可能：

```bash
# Dockerfileを使って手動デプロイ
docker build -t gcr.io/YOUR_PROJECT/corporation-api .
docker push gcr.io/YOUR_PROJECT/corporation-api
gcloud run deploy corporation-api --image gcr.io/YOUR_PROJECT/corporation-api
```

### その他のデプロイ先

- **AWS ECS/Fargate**: Dockerfileをそのまま利用可能
- **Heroku**: PostgreSQLアドオンと組み合わせて簡単デプロイ
- **VPS（さくら、Conoha等）**: Docker ComposeでそのままデプロイOK

## 🗂️ プロジェクト構造

```
corporation-project/
├── src/
│   ├── server.ts          # h3サーバーのエントリーポイント
│   ├── routes/
│   │   ├── search.ts      # 検索APIエンドポイント (PostgreSQL版)
│   │   ├── search-bigquery.ts  # 検索APIエンドポイント (BigQuery版)
│   │   ├── swagger.ts     # Swagger UIエンドポイント
│   │   └── openapi.ts     # OpenAPI JSONエンドポイント
│   ├── db/
│   │   ├── index.ts       # Drizzle ORM接続設定 (PostgreSQL)
│   │   ├── schema.ts      # Drizzleスキーマ定義
│   │   └── bigquery.ts    # BigQueryクライアント設定
│   └── openapi/
│       └── spec.ts        # OpenAPI 3.0仕様書
├── scripts/
│   └── import-data.ts     # データインポートスクリプト
├── drizzle/               # マイグレーションファイル（自動生成）
├── data/                  # CSVファイル格納ディレクトリ
├── docker-compose.yml     # Docker Compose設定
├── Dockerfile             # 本番環境用
├── .dockerignore
├── .env                   # 環境変数（要作成）
├── .env.example           # 環境変数テンプレート
├── drizzle.config.ts      # Drizzle Kit設定
├── package.json
├── tsconfig.json
└── README.md
```

## 📊 データベーススキーマ

### テーブル: `corporations`

| カラム名 | 型 | 制約 | 説明 |
|---------|------|------|------|
| `id` | serial | PRIMARY KEY | 内部ID |
| `corporate_number` | varchar(13) | UNIQUE, NOT NULL | 法人番号 |
| `name` | varchar(255) | NOT NULL | 法人名 |
| `prefecture_name` | varchar(50) | - | 都道府県名 |
| `city_name` | varchar(100) | - | 市区町村名 |
| `street_number` | varchar(255) | - | 丁目番地等 |
| `updated_at` | timestamp | DEFAULT NOW() | 更新日時 |

### インデックス

- `idx_corporations_name`: 企業名での高速検索
- `idx_corporations_corporate_number`: 法人番号での高速検索

### Drizzle ORMスキーマ

詳細は [`src/db/schema.ts`](./src/db/schema.ts) を参照してください。

## 🔧 トラブルシューティング

### Docker環境

| 問題 | 解決方法 |
|------|---------|
| コンテナが起動しない | `npm run docker:ps` で状態確認、`npm run docker:logs` でログ確認 |
| DBに接続できない | `npm run docker:down && npm run docker:up` で再起動 |
| ポート競合エラー | `.env` で `PORT` を変更（例: `PORT=3001`） |
| データがクリアされた | `npm run db:migrate` → `npm run import` で再構築 |

```bash
# 完全クリーンアップして再起動
npm run docker:clean
npm run docker:up
npm run db:migrate
```

> 📖 詳細: [Docker環境ガイド](./docs/DOCKER.md#トラブルシューティング)

### ローカル環境

| 問題 | 解決方法 |
|------|---------|
| `DATABASE_URL` 接続エラー | PostgreSQLの起動確認 `pg_isready` |
| ポート使用中 | `.env` の `PORT` を変更 |
| マイグレーションエラー | `drizzle/` フォルダを削除し `npm run db:generate` |
| インポートが遅い | `.env` で `BATCH_SIZE` を小さく（例: `500`） |

> 📖 詳細: [セットアップガイド](./docs/SETUP.md#トラブルシューティング)

---

## 👥 開発に参加する

### 貢献方法

プロジェクトへの貢献を歓迎します！

1. **Issueを確認**: [既存のIssue](../../issues)を確認するか、新規作成
2. **Forkしてブランチ作成**: `git checkout -b feature/your-feature`
3. **変更をコミット**: `git commit -m "Add: 新機能の説明"`
4. **Pull Request**: 変更内容と目的を明記してPRを作成

### 開発環境のセットアップ

```bash
# リポジトリをフォークしてクローン
git clone https://github.com/YOUR_USERNAME/corporation-project.git
cd corporation-project

# 開発環境を起動
npm run setup

# コードを編集（自動リロード有効）
npm run dev
```

### コーディング規約

- **TypeScript**: 型定義を必ず記述
- **Linting**: ESLintルールに従う（`npm run lint`）
- **Commit**: [Conventional Commits](https://www.conventionalcommits.org/)形式を推奨

---

## 📚 ドキュメント

- **API仕様書**: [Swagger UI](http://localhost:3000/api-docs) - インタラクティブなAPIドキュメント
- **BigQueryセットアップ**: [セットアップガイド](./docs/BIGQUERY_SETUP.md) - BigQueryへの移行手順
- **データフォーマット**: 国税庁法人番号システムのCSV形式に準拠
- **Drizzle ORM**: [公式ドキュメント](https://orm.drizzle.team/) - ORMの詳細情報

---

## 🙏 謝辞

- [国税庁法人番号システム](https://www.houjin-bangou.nta.go.jp/) - 法人データを提供
- [h3](https://github.com/unjs/h3) - 軽量で高速なWebフレームワーク
- [Drizzle ORM](https://orm.drizzle.team/) - 型安全で優れたORM

---

## 📄 ライセンス

このプロジェクトは [ISC License](https://opensource.org/licenses/ISC) の下で公開されています。

```
Copyright (c) 2024

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.
```

---

<div align="center">

**⭐ このプロジェクトが役立ったら、スターをお願いします！**

Made with ❤️ using TypeScript and h3

</div>
