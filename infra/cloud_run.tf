# 同一イメージを MODE 環境変数で切り替えて2サービスとしてデプロイする（要件定義 #18）。
# イメージの更新は GitHub Actions（deploy.yml）が行うため、Terraform は image の差分を無視する。

resource "google_cloud_run_v2_service" "api" {
  name                = "browser-gate-api"
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_ALL"
  deletion_protection = true

  template {
    service_account                  = google_service_account.api.email
    execution_environment            = "EXECUTION_ENVIRONMENT_GEN2"
    max_instance_request_concurrency = 1
    timeout                          = "120s" # 最大 timeout_ms(60秒) + Chromium 起動・出力生成の余裕

    scaling {
      min_instance_count = 0
      max_instance_count = 3
    }

    containers {
      image = local.image

      ports {
        container_port = 8080
      }

      resources {
        limits = {
          cpu    = "2"
          memory = "4Gi"
        }
        # リクエスト ベース課金（リクエスト処理中のみ CPU を割り当てる）。取得ごとに完結する api 向け。
        cpu_idle = true
      }

      env {
        name  = "MODE"
        value = "api"
      }
      # 宛先の IPv4 を IPv6 より先に試す（切り分け用。既定 false は従来どおり）
      env {
        name  = "EGRESS_PREFER_IPV4"
        value = var.egress_prefer_ipv4 ? "true" : ""
      }
      env {
        name  = "CONFIG_PATH"
        value = local.config_mount_path
      }
      # ログイン済みプロファイルの読み取り用（Phase 4 最小部分）。値は Terraform に書かず、鍵は実行時に Secret Manager から参照する。
      env {
        name  = "GCS_BUCKET"
        value = google_storage_bucket.profiles.name
      }
      env {
        name = "PROFILE_ENCRYPTION_KEY"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.this["profile_encryption"].secret_id
            version = "latest"
          }
        }
      }

      volume_mounts {
        name       = "config"
        mount_path = local.config_mount_dir
      }

      startup_probe {
        http_get {
          path = "/healthz"
        }
        period_seconds    = 5
        timeout_seconds   = 3
        failure_threshold = 12
      }
    }

    volumes {
      name = "config"
      secret {
        secret = google_secret_manager_secret.this["config"].secret_id
        items {
          version = "latest"
          path    = local.config_file_name
        }
      }
    }
  }

  lifecycle {
    ignore_changes = [
      template[0].containers[0].image,
      client,
      client_version,
    ]
  }

  depends_on = [
    google_secret_manager_secret_version.config_initial,
    google_secret_manager_secret_iam_member.api_config,
    google_secret_manager_secret_iam_member.api_profile_encryption,
    google_storage_bucket_iam_member.api_profiles,
  ]
}

resource "google_cloud_run_v2_service" "login" {
  name                = "browser-gate-login"
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_ALL"
  deletion_protection = true

  template {
    service_account                  = google_service_account.login.email
    execution_environment            = "EXECUTION_ENVIRONMENT_GEN2"
    session_affinity                 = true
    max_instance_request_concurrency = 10 # noVNC は WebSocket を含む複数接続を使うため 1 にしない
    timeout                          = "3600s"

    scaling {
      min_instance_count = 0
      max_instance_count = 1
    }

    containers {
      image = local.image

      ports {
        container_port = 8080
      }

      resources {
        limits = {
          cpu    = "2"
          memory = "4Gi"
        }
        # インスタンス ベース課金（CPU 常時割当）のまま。x11vnc / websockify の常駐プロセスと WebSocket が
        # リクエスト外でも動く必要があるため、cpu_idle は指定しない（false 相当）。
      }

      env {
        name  = "MODE"
        value = "login"
      }
      # 宛先の IPv4 を IPv6 より先に試す（切り分け用。既定 false は従来どおり）
      env {
        name  = "EGRESS_PREFER_IPV4"
        value = var.egress_prefer_ipv4 ? "true" : ""
      }
      env {
        name  = "CONFIG_PATH"
        value = local.config_mount_path
      }
      # OAuth のリダイレクトURI（<この値>/oauth/callback）と Origin 検査の基準。Cloud Run の決定的なURLを固定で使う。
      env {
        name  = "PUBLIC_BASE_URL"
        value = local.login_public_url
      }
      env {
        name  = "ALLOWED_EMAILS"
        value = join(",", var.login_allowed_emails)
      }
      # ログイン用ブラウザの方式（plain / playwright）。切り替えは変数を変えて apply するだけで、切り戻しも同じ手順
      env {
        name  = "LOGIN_BROWSER_MODE"
        value = var.login_browser_mode
      }
      env {
        name  = "GCS_BUCKET"
        value = google_storage_bucket.profiles.name
      }
      # 値は Terraform に書かず、Secret Manager の最新バージョンを実行時に参照する。
      env {
        name = "PROFILE_ENCRYPTION_KEY"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.this["profile_encryption"].secret_id
            version = "latest"
          }
        }
      }
      env {
        name = "OAUTH_CLIENT_JSON"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.this["oauth_client"].secret_id
            version = "latest"
          }
        }
      }
      # noVNC（websockify）はコンテナ内の 127.0.0.1 のみで待ち受ける。外部へは OAuth 認証済みの利用者だけにアプリが中継する。

      volume_mounts {
        name       = "config"
        mount_path = local.config_mount_dir
      }

      startup_probe {
        http_get {
          path = "/healthz"
        }
        period_seconds    = 5
        timeout_seconds   = 3
        failure_threshold = 12
      }
    }

    volumes {
      name = "config"
      secret {
        secret = google_secret_manager_secret.this["config"].secret_id
        items {
          version = "latest"
          path    = local.config_file_name
        }
      }
    }
  }

  lifecycle {
    ignore_changes = [
      template[0].containers[0].image,
      client,
      client_version,
    ]
  }

  # シークレットの有効なバージョン（値の登録）と実行用 SA の権限が揃ってからリビジョンを作る。
  depends_on = [
    google_secret_manager_secret_version.config_initial,
    google_secret_manager_secret_iam_member.login_config,
    google_secret_manager_secret_iam_member.login_profile_encryption,
    google_secret_manager_secret_iam_member.login_oauth_client,
    google_storage_bucket_iam_member.login_profiles,
  ]
}
