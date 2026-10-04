# --- 実行用サービスアカウント（最小権限） ---
# api / login で分け、必要なリソースにだけ権限を付与する（--no-sandbox 受容の条件）。
# プロジェクト全体のロールは付与しない。
resource "google_service_account" "api" {
  account_id   = "browser-gate-api"
  display_name = "browser-gate-api (Cloud Run runtime)"
}

resource "google_service_account" "login" {
  account_id   = "browser-gate-login"
  display_name = "browser-gate-login (Cloud Run runtime)"
}

# 設定JSONの読み取り（このシークレット1つだけ）
resource "google_secret_manager_secret_iam_member" "api_config" {
  secret_id = google_secret_manager_secret.this["config"].id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.api.email}"
}

resource "google_secret_manager_secret_iam_member" "login_config" {
  secret_id = google_secret_manager_secret.this["config"].id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.login.email}"
}

# Phase 2 の匿名取得は GCS・暗号鍵・OAuth・Slack を使わないため、これらへの権限は付与しない。
# Phase 3 / 4 で必要になった時点で、対象バケット・対象シークレットに限定して追加する。

# --- 公開設定 ---
# 取得APIはアプリ側の APIキー認証（Bearer）で守るため、Cloud Run の IAM 認証は要求しない（要件定義 #8）。
resource "google_cloud_run_v2_service_iam_member" "api_public" {
  name     = google_cloud_run_v2_service.api.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# ログイン用は Phase 3（OAuth）実装まで未認証の呼び出しを許可しない。
resource "google_cloud_run_v2_service_iam_member" "login_public" {
  count    = var.login_public_access ? 1 : 0
  name     = google_cloud_run_v2_service.login.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# --- デプロイ用サービスアカウント（GitHub Actions が Workload Identity Federation で利用） ---
resource "google_service_account" "deployer" {
  account_id   = "browser-gate-deployer"
  display_name = "browser-gate-deployer (GitHub Actions)"
}

# イメージの push（このリポジトリだけ）
resource "google_artifact_registry_repository_iam_member" "deployer_writer" {
  location   = google_artifact_registry_repository.browser_gate.location
  repository = google_artifact_registry_repository.browser_gate.name
  role       = "roles/artifactregistry.writer"
  member     = "serviceAccount:${google_service_account.deployer.email}"
}

# 2サービスの更新（サービス単位。新規作成・削除はできない）
resource "google_cloud_run_v2_service_iam_member" "deployer_api" {
  name     = google_cloud_run_v2_service.api.name
  location = var.region
  role     = "roles/run.developer"
  member   = "serviceAccount:${google_service_account.deployer.email}"
}

resource "google_cloud_run_v2_service_iam_member" "deployer_login" {
  name     = google_cloud_run_v2_service.login.name
  location = var.region
  role     = "roles/run.developer"
  member   = "serviceAccount:${google_service_account.deployer.email}"
}

# デプロイ時に実行用サービスアカウントとして動かすための権限（対象SAごと）
resource "google_service_account_iam_member" "deployer_acts_as_api" {
  service_account_id = google_service_account.api.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.deployer.email}"
}

resource "google_service_account_iam_member" "deployer_acts_as_login" {
  service_account_id = google_service_account.login.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.deployer.email}"
}
