output "cloud_run_url" {
  description = "Cloud Run サービスURL"
  value       = google_cloud_run_v2_service.api.uri
}

output "cloud_sql_connection_name" {
  description = "Cloud SQL 接続名（Cloud Build の _DATABASE_URL_SECRET 設定に使用）"
  value       = google_sql_database_instance.db.connection_name
  sensitive   = true
}

output "artifact_registry_url" {
  description = "Artifact Registry URL（Cloud Build の _AR_HOSTNAME 設定に使用）"
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/corporation-search"
}

output "matching_service_account_email" {
  description = "名寄せシステム用サービスアカウント（corporation-matching の .env に設定）"
  value       = google_service_account.matching.email
}

output "vertex_ai_location" {
  description = "Vertex AI リージョン（corporation-matching の GCP_LOCATION に設定）"
  value       = var.region
}
