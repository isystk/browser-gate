output "api_url" {
  description = "browser-gate-api の URL"
  value       = google_cloud_run_v2_service.api.uri
}

output "login_url" {
  description = "browser-gate-login の URL"
  value       = google_cloud_run_v2_service.login.uri
}

output "image_repository" {
  description = "イメージの push 先（タグを除く）"
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${local.repository_id}/browser-gate"
}

output "github_workload_identity_provider" {
  description = "GitHub Actions の変数 GCP_WORKLOAD_IDENTITY_PROVIDER に設定する値"
  value       = google_iam_workload_identity_pool_provider.github.name
}

output "github_deployer_service_account" {
  description = "GitHub Actions の変数 GCP_DEPLOYER_SA に設定する値"
  value       = google_service_account.deployer.email
}
