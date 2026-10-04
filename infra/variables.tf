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
  description = "browser-gate-login を Cloud Run の IAM 認証なしで呼び出せるようにするか。アプリ側の Google OAuth で守る（Phase 3）"
  type        = bool
  default     = true
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

variable "login_browser_mode" {
  description = "ログイン用ブラウザの方式。plain: Playwright/CDP なしの素の Chromium（閉じた後に Cookie 等を取り込む）、playwright: 従来方式。本番確認が済むまでは playwright が既定"
  type        = string
  default     = "playwright"

  validation {
    condition     = contains(["playwright", "plain"], var.login_browser_mode)
    error_message = "login_browser_mode は playwright または plain を指定してください。"
  }
}

variable "login_allowed_emails" {
  description = "ログイン画面（/login）に入れる Google アカウントのメールアドレス"
  type        = list(string)
  default     = ["ise0615@gmail.com"]
}
