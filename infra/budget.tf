# 予算アラート（月500円）。課金アカウント側の権限（Billing Account Administrator 等）が必要なため、
# billing_account_id を指定した場合のみ作成する。通知先は課金アカウントの管理者（既定の IAM 受信者）。
resource "google_billing_budget" "monthly" {
  count           = var.billing_account_id == "" ? 0 : 1
  billing_account = var.billing_account_id
  display_name    = "browser-gate monthly budget"

  budget_filter {
    projects               = ["projects/${data.google_project.this.number}"]
    calendar_period        = "MONTH"
    credit_types_treatment = "INCLUDE_ALL_CREDITS"
  }

  amount {
    specified_amount {
      currency_code = "JPY"
      units         = tostring(var.budget_amount_jpy)
    }
  }

  threshold_rules {
    threshold_percent = 0.5
  }
  threshold_rules {
    threshold_percent = 1.0
  }
  threshold_rules {
    threshold_percent = 1.0
    spend_basis       = "FORECASTED_SPEND"
  }
}
