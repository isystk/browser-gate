# Secret Manager は「器」のみ作成する。値（キー・Webhook URL・OAuth情報）は Terraform に書かず、
# gcloud / CLI で登録する（state に秘密情報を残さないため）。
locals {
  secret_ids = {
    config             = "browser-gate-config"                 # 設定JSON（APIキーのハッシュ・プロファイル・許可ドメイン）
    profile_encryption = "browser-gate-profile-encryption-key" # プロファイル暗号鍵（Phase 3）
    slack_webhook_url  = "browser-gate-slack-webhook-url"      # Slack Incoming Webhook URL（Phase 4）
    oauth_client       = "browser-gate-oauth-client"           # Google OAuth クライアント情報（Phase 3）
  }
}

resource "google_secret_manager_secret" "this" {
  for_each  = local.secret_ids
  secret_id = each.value

  replication {
    auto {}
  }
}

# Cloud Run はマウントするシークレットに有効なバージョンが必要なため、設定JSONだけ「空の設定」を初期値として登録する。
# 秘密情報は含まない（APIキー無し）。以降の更新は `make config-push` が新バージョンを追加する。
resource "google_secret_manager_secret_version" "config_initial" {
  secret      = google_secret_manager_secret.this["config"].id
  secret_data = jsonencode({ api_keys = [], profiles = {} })

  lifecycle {
    ignore_changes = [secret_data]
  }
}
