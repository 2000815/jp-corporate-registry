# Terraform GCP 環境構築

このTerraform構成は、Cloud Run + Cloud SQL PostgreSQLを使った企業検索APIのGCP環境を構築します。

## 構成概要

- **Cloud Run**: APIサーバー実行環境
- **Cloud SQL PostgreSQL**: アプリケーションデータ格納
- **Artifact Registry**: Dockerイメージ管理
- **VPC**: Cloud SQLプライベート接続用

## ディレクトリ構成

```
terraform/
├── modules/              # 再利用可能なモジュール
│   ├── vpc/              # VPCネットワーク
│   ├── cloud_sql/        # Cloud SQL PostgreSQL
│   ├── artifact_registry/ # コンテナレジストリ
│   └── cloud_run/        # Cloud Runサービス
├── environments/         # 環境固有の設定
│   ├── dev/              # 開発環境
│   └── prod/             # 本番環境
└── README.md             # このファイル
```

## 前提条件

1. **GCPプロジェクト作成済み**
2. **gcloud CLI認証済み**
   ```bash
   gcloud auth application-default login
   ```
3. **Terraformインストール済み** (v1.5+)
   ```bash
   terraform --version
   ```
4. **必要なAPI有効化済み**
   ```bash
   gcloud services enable compute.googleapis.com
   gcloud services enable sqladmin.googleapis.com
   gcloud services enable artifactregistry.googleapis.com
   gcloud services enable run.googleapis.com
   gcloud services enable servicenetworking.googleapis.com
   ```

## クイックスタート

### 1. 設定ファイルの準備

```bash
cd terraform/environments/dev

# サンプルからコピー
cp terraform.tfvars.example terraform.tfvars

# エディタで編集
vim terraform.tfvars
```

### 2. Terraform実行

```bash
# 初期化
terraform init

# 変更プレビュー
terraform plan

# 適用（作成）
terraform apply
```

### 3. 出力確認

```bash
terraform output
# - cloud_run_url: APIエンドポイント
# - cloud_sql_connection_name: データベース接続情報
# - artifact_registry_url: コンテナレジストリ
```

## 環境別設定

### 開発環境 (dev)

```bash
cd terraform/environments/dev
```

**特徴**:
- 小さめのインスタンス (db-f1-micro)
- 自動バックアップ無効
- 削除保護無効
- パブリックアクセス許可

### 本番環境 (prod)

```bash
cd terraform/environments/prod
```

**特徴**:
- 本番用インスタンス (db-g1-small以上)
- 自動バックアップ有効（30日保持）
- 削除保護有効
- スケーリング設定あり

## デプロイ手順

### 1. コンテナイメージのビルドとプッシュ

```bash
# リポジトリURL取得
REPO_URL=$(terraform -chdir=terraform/environments/dev output -raw artifact_registry_url)

# Dockerイメージビルド
docker build -t corp-search-api:latest .

# タグ付け
docker tag corp-search-api:latest ${REPO_URL}/corp-search-api:latest

# プッシュ
docker push ${REPO_URL}/corp-search-api:latest
```

### 2. Cloud Runにデプロイ

```bash
# Cloud Run更新（新しいイメージで）
gcloud run deploy corp-search-api-dev \
  --image ${REPO_URL}/corp-search-api:latest \
  --region asia-northeast1
```

## コマンドリファレンス

```bash
# 変更確認
terraform plan

# 適用
terraform apply

# 削除（注意！）
terraform destroy

# 状態確認
terraform show

# 出力値確認
terraform output

# フォーマット
terraform fmt

# 検証
terraform validate
```

## トラブルシューティング

### Cloud SQL接続エラー

```
# Cloud SQL Auth Proxyを使用してローカルから接続
cloud-sql-proxy --port 5433 PROJECT:REGION:INSTANCE
```

### パーミッションエラー

```
# サービスアカウント権限確認
gcloud projects get-iam-policy PROJECT_ID
```

### Terraform状態の競合

```
# 状態ロック解除（緊急時のみ）
terraform force-unlock LOCK_ID
```

## 注意事項

- **terraform.tfvarsは.gitignoreに追加してください**（パスワード等の機密情報含む）
- **本番環境ではdeletion_protection = trueを必ず設定**
- **terraform.tfstateはGCSバックエンドで管理することを推奨**
- **Cloud SQLパスワードは十分に長く複雑なものを使用**

## コスト見積もり

| リソース | dev環境（月額） | prod環境（月額） |
|---------|---------------|----------------|
| Cloud SQL (PostgreSQL) | ~$10 | ~$30-100 |
| Cloud Run | ~$0-10 | ~$10-50 |
| Artifact Registry | ~$0.10/GB | ~$0.10/GB |

*注: 実際のコストは使用量により変動します*

## 参考リンク

- [Terraform GCP Provider](https://registry.terraform.io/providers/hashicorp/google/latest/docs)
- [Cloud Run Terraform](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/cloud_run_service)
- [Cloud SQL Terraform](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/sql_database_instance)
