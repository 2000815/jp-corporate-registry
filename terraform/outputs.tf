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
