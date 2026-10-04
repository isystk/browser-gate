terraform {
  required_version = ">= 1.9"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }

  # state は GCS に保存する（バケットは Terraform 管理外。社長が作成済み）
  backend "gcs" {
    bucket = "isystk-tfstate"
    prefix = "browser-gate"
  }
}

provider "google" {
  project = var.project_id
  region  = var.region

  # 予算アラート（Billing Budgets API）はクォータプロジェクトの指定が必要
  user_project_override = true
  billing_project       = var.project_id
}
