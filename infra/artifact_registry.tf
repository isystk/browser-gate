resource "google_artifact_registry_repository" "browser_gate" {
  location      = var.region
  repository_id = local.repository_id
  format        = "DOCKER"
  description   = "browser-gate コンテナイメージ"

  # 古いイメージによる課金増を避けるため、直近10世代だけ残す
  cleanup_policies {
    id     = "keep-recent-versions"
    action = "KEEP"
    most_recent_versions {
      keep_count = 10
    }
  }
  cleanup_policies {
    id     = "delete-old-versions"
    action = "DELETE"
    condition {
      older_than = "2592000s" # 30日
    }
  }
}
