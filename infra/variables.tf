variable "project_id" {
  description = "GCP プロジェクトID"
  type        = string
  default     = "isystk"
}

variable "region" {
  description = "リージョン"
  type        = string
  default     = "asia-northeast1"
}

variable "github_repository" {
  description = "Workload Identity Federation で認証を許可する GitHub リポジトリ（owner/name）"
  type        = string
  default     = "isystk/browser-gate"
}

variable "github_deploy_ref" {
  description = "デプロイを許可する Git ref"
  type        = string
  default     = "refs/heads/main"
}

variable "image_tag" {
  description = "Cloud Run 初回作成時のイメージタグ（以降のデプロイは GitHub Actions が更新するため Terraform は差分を無視する）"
  type        = string
  default     = "latest"
}

variable "login_public_access" {
  description = "browser-gate-login を未認証で呼び出せるようにするか。Phase 3 で OAuth 認証を実装するまでは false"
  type        = bool
  default     = false
}

variable "billing_account_id" {
  description = "予算アラートを作成する課金アカウントID（例: 000000-000000-000000）。空の場合は予算アラートを作成しない"
  type        = string
  default     = ""
}

variable "budget_amount_jpy" {
  description = "月次の予算額（円）"
  type        = number
  default     = 500
}
