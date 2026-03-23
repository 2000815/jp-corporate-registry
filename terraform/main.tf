terraform {
  required_version = ">= 1.5.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }

  # GCSバックエンド（state管理用バケット作成後にコメント解除）
  # backend "gcs" {
  #   bucket = "YOUR_TF_STATE_BUCKET"
  #   prefix = "corporation-search-api"
  # }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

# ----------------------------------------------------------------
# 必要なAPI有効化
# ----------------------------------------------------------------
resource "google_project_service" "apis" {
  for_each = toset([
    "run.googleapis.com",
    "sqladmin.googleapis.com",
    "artifactregistry.googleapis.com",
    "secretmanager.googleapis.com",
    "cloudscheduler.googleapis.com",
    "servicenetworking.googleapis.com",
    "aiplatform.googleapis.com",
  ])
  service            = each.value
  disable_on_destroy = false
}

# ----------------------------------------------------------------
# Artifact Registry
# ----------------------------------------------------------------
resource "google_artifact_registry_repository" "repo" {
  depends_on    = [google_project_service.apis]
  location      = var.region
  repository_id = "corporation-search"
  format        = "DOCKER"

  cleanup_policies {
    id     = "keep-recent"
    action = "KEEP"
    most_recent_versions {
      keep_count = 10
    }
  }
}

# ----------------------------------------------------------------
# Cloud SQL (PostgreSQL 14)
# ----------------------------------------------------------------
resource "google_sql_database_instance" "db" {
  depends_on       = [google_project_service.apis]
  name             = "${var.service_name}-db"
  database_version = "POSTGRES_14"
  region           = var.region

  deletion_protection = true

  settings {
    tier      = var.db_tier
    disk_size = 20
    disk_type = "PD_SSD"

    backup_configuration {
      enabled    = true
      start_time = "03:00"
      backup_retention_settings {
        retained_backups = 7
      }
    }

    maintenance_window {
      day  = 7 # 日曜日
      hour = 4 # JST 13:00
    }
  }
}

resource "google_sql_database" "db" {
  name     = var.db_name
  instance = google_sql_database_instance.db.name
}

resource "google_sql_user" "user" {
  name     = var.db_user
  instance = google_sql_database_instance.db.name
  password = var.db_password
}

# ----------------------------------------------------------------
# Secret Manager
# ----------------------------------------------------------------
resource "google_secret_manager_secret" "database_url" {
  depends_on = [google_project_service.apis]
  secret_id  = "${var.service_name}-database-url"
  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "database_url" {
  secret = google_secret_manager_secret.database_url.id
  # Cloud Run の Cloud SQL ソケット経由で接続
  # host= クエリパラメータでソケットパスを指定（db/index.ts 側で処理）
  secret_data = "postgresql://${var.db_user}:${var.db_password}@localhost/${var.db_name}?host=/cloudsql/${google_sql_database_instance.db.connection_name}"
}

resource "google_secret_manager_secret" "api_key" {
  depends_on = [google_project_service.apis]
  secret_id  = "${var.service_name}-api-key"
  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "api_key" {
  secret      = google_secret_manager_secret.api_key.id
  secret_data = var.api_key
}

# ----------------------------------------------------------------
# Cloud Run 用サービスアカウント
# ----------------------------------------------------------------
resource "google_service_account" "cloud_run" {
  account_id   = "${var.service_name}-run"
  display_name = "Cloud Run SA - ${var.service_name}"
}

resource "google_project_iam_member" "cloud_run_sql_client" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.cloud_run.email}"
}

resource "google_secret_manager_secret_iam_member" "cloud_run_database_url" {
  secret_id = google_secret_manager_secret.database_url.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.cloud_run.email}"
}

resource "google_secret_manager_secret_iam_member" "cloud_run_api_key" {
  secret_id = google_secret_manager_secret.api_key.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.cloud_run.email}"
}

# ----------------------------------------------------------------
# Cloud Run (v2)
# ----------------------------------------------------------------
resource "google_cloud_run_v2_service" "api" {
  depends_on = [
    google_project_service.apis,
    google_secret_manager_secret_iam_member.cloud_run_database_url,
    google_secret_manager_secret_iam_member.cloud_run_api_key,
  ]

  name     = var.service_name
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"

  template {
    service_account = google_service_account.cloud_run.email

    scaling {
      min_instance_count = var.min_instances
      max_instance_count = var.max_instances
    }

    # Cloud SQL Auth Proxy ソケット
    volumes {
      name = "cloudsql"
      cloud_sql_instance {
        instances = [google_sql_database_instance.db.connection_name]
      }
    }

    containers {
      image = var.container_image

      ports {
        container_port = 8080
      }

      resources {
        limits = {
          cpu    = var.cpu_limit
          memory = var.memory_limit
        }
      }

      env {
        name  = "NODE_ENV"
        value = "production"
      }

      env {
        name = "DATABASE_URL"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.database_url.secret_id
            version = "latest"
          }
        }
      }

      env {
        name = "API_KEY"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.api_key.secret_id
            version = "latest"
          }
        }
      }

      volume_mounts {
        name       = "cloudsql"
        mount_path = "/cloudsql"
      }
    }
  }
}

# 公開アクセス許可（内部APIの場合は削除して IAM で制御）
resource "google_cloud_run_v2_service_iam_binding" "public" {
  name     = google_cloud_run_v2_service.api.name
  location = var.region
  role     = "roles/run.invoker"
  members  = ["allUsers"]
}

# ----------------------------------------------------------------
# 名寄せシステム（corporation-matching）用サービスアカウント
# ----------------------------------------------------------------
resource "google_service_account" "matching" {
  depends_on   = [google_project_service.apis]
  account_id   = "corporation-matching"
  display_name = "Corporation Matching SA - Vertex AI + Cloud SQL"
  description  = "法人名寄せバッチ処理用。Vertex AI Gemini の呼び出しと Cloud SQL の読み取りに使用。"
}

# Vertex AI Gemini の呼び出し権限
resource "google_project_iam_member" "matching_vertex_ai" {
  project = var.project_id
  role    = "roles/aiplatform.user"
  member  = "serviceAccount:${google_service_account.matching.email}"
}

# Cloud SQL への読み取り接続権限
resource "google_project_iam_member" "matching_sql_client" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.matching.email}"
}

# ----------------------------------------------------------------
# Cloud Scheduler（日次差分インポート JST 01:00）
# ----------------------------------------------------------------
resource "google_cloud_scheduler_job" "sync_diff" {
  depends_on = [google_project_service.apis]

  name      = "${var.service_name}-sync-diff"
  region    = var.region
  schedule  = "0 1 * * *"
  time_zone = "Asia/Tokyo"

  http_target {
    uri         = "${google_cloud_run_v2_service.api.uri}/api/sync/diff"
    http_method = "POST"
    headers = {
      "Content-Type" = "application/json"
      "X-API-Key"    = var.api_key
    }
    body = base64encode("{}")
  }
}
