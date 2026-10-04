data "google_project" "this" {
  project_id = var.project_id
}

locals {
  repository_id = "browser-gate"
  image         = "${var.region}-docker.pkg.dev/${var.project_id}/${local.repository_id}/browser-gate:${var.image_tag}"

  # 取得結果・プロファイル用バケット（グローバルで一意な名前）
  profile_bucket_name = "${var.project_id}-browser-gate-profiles"

  # Secret Manager の設定JSONをコンテナへマウントする場所
  config_mount_dir  = "/secrets/config"
  config_file_name  = "config.json"
  config_mount_path = "${local.config_mount_dir}/${local.config_file_name}"

  # ログイン用サービスの決定的な URL（プロジェクト番号入り）。OAuth のリダイレクトURI・Origin 検査の基準として固定で使う
  login_public_url = "https://browser-gate-login-${data.google_project.this.number}.${var.region}.run.app"
}
