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

# api（Phase 4 最小部分）: ログイン済みプロファイルを使った取得のため、プロファイル暗号鍵の読み取りと
# プロファイル用バケットの読み取り専用アクセスだけを許可する（書き込み・削除は付与しない。Cookie 書き戻しは未実装）。
resource "google_secret_manager_secret_iam_member" "api_profile_encryption" {
  secret_id = google_secret_manager_secret.this["profile_encryption"].id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.api.email}"
}

resource "google_storage_bucket_iam_member" "api_profiles" {
  bucket = google_storage_bucket.profiles.name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.api.email}"
}

# login（Phase 3）: プロファイル暗号鍵・OAuth クライアント情報の読み取りと、プロファイル用バケットへの保存だけを許可する。
# Slack Webhook（Phase 4）への権限は Phase 4 で追加する。api には OAuth の権限を付与しない。
resource "google_secret_manager_secret_iam_member" "login_profile_encryption" {
  secret_id = google_secret_manager_secret.this["profile_encryption"].id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.login.email}"
}

resource "google_secret_manager_secret_iam_member" "login_oauth_client" {
  secret_id = google_secret_manager_secret.this["oauth_client"].id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.login.email}"
}

# 作成・上書き（既存オブジェクトの置換には delete 権限が必要）・読み取りができる。対象はこのバケットのみ。
resource "google_storage_bucket_iam_member" "login_profiles" {
  bucket = google_storage_bucket.profiles.name
  role   = "roles/storage.objectUser"
  member = "serviceAccount:${google_service_account.login.email}"
}

# --- 公開設定 ---
# 取得APIはアプリ側の APIキー認証（Bearer）で守るため、Cloud Run の IAM 認証は要求しない（要件定義 #8）。
resource "google_cloud_run_v2_service_iam_member" "api_public" {
  name     = google_cloud_run_v2_service.api.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# ログイン用は未認証で到達できるが、アプリ側で Google OAuth と許可メールアドレスにより守る（要件定義 #8）。
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
