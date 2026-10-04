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
      env {
        name  = "CONFIG_PATH"
        value = local.config_mount_path
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
      # noVNC（websockify）は NOVNC_LISTEN の既定どおり 127.0.0.1 のみで待ち受ける。外部へは公開しない。

      startup_probe {
        http_get {
          path = "/healthz"
        }
        period_seconds    = 5
        timeout_seconds   = 3
        failure_threshold = 12
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
}
