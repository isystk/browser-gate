# 暗号化済みプロファイル・ロック用バケット（Phase 3 以降で使用。非公開・バージョニング有効）
resource "google_storage_bucket" "profiles" {
  name     = local.profile_bucket_name
  location = var.region

  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false

  versioning {
    enabled = true
  }

  # 過去版が増え続けないよう、非現行版は30日で削除する
  lifecycle_rule {
    condition {
      days_since_noncurrent_time = 30
    }
    action {
      type = "Delete"
    }
  }
}
