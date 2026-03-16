variable "project_id" {
  description = "GCPプロジェクトID"
  type        = string
  default     = "jp-corporate-search"
}

variable "region" {
  description = "GCPリージョン"
  type        = string
  default     = "asia-northeast1"
}

variable "service_name" {
  description = "サービス名（Cloud Run・各リソースのプレフィックス）"
  type        = string
  default     = "corporation-search-api"
}

variable "db_name" {
  description = "データベース名"
  type        = string
  default     = "corporations_db"
}

variable "db_user" {
  description = "データベースユーザー名"
  type        = string
  default     = "app_user"
}

variable "db_password" {
  description = "データベースパスワード"
  type        = string
  sensitive   = true
}

variable "db_tier" {
  description = "Cloud SQLインスタンスタイプ"
  type        = string
  default     = "db-g1-small"
}

variable "api_key" {
  description = "差分同期APIの認証キー（X-API-Key）"
  type        = string
  sensitive   = true
}

variable "container_image" {
  description = "Cloud Runコンテナイメージ（初回デプロイ前はプレースホルダー）"
  type        = string
  default     = "gcr.io/cloudrun/hello:latest"
}

variable "cpu_limit" {
  description = "Cloud Run CPU制限"
  type        = string
  default     = "1"
}

variable "memory_limit" {
  description = "Cloud Run メモリ制限"
  type        = string
  default     = "1Gi"
}

variable "min_instances" {
  description = "Cloud Run 最小インスタンス数"
  type        = number
  default     = 0
}

variable "max_instances" {
  description = "Cloud Run 最大インスタンス数"
  type        = number
  default     = 3
}
