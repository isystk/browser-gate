const SAVE_URL = '/login/save';
const CANCEL_URL = '/login/cancel';

const statusElement = document.getElementById('status');
const saveButton = document.getElementById('save');
const cancelButton = document.getElementById('cancel');
const frame = document.getElementById('vnc');

saveButton.addEventListener('click', () => run(SAVE_URL, formatSaved));
cancelButton.addEventListener('click', () =>
  run(CANCEL_URL, () => '中止しました'),
);

async function run(url, formatSuccess) {
  setBusy(true);
  statusElement.textContent = '処理中...';
  try {
    const response = await fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'X-Requested-With': 'browser-gate' },
    });
    const body = await response.json();
    if (!response.ok) {
      statusElement.textContent = `失敗: ${body.error?.message ?? response.status}`;
      setBusy(false);
      return;
    }
    frame.hidden = true;
    statusElement.textContent = `${formatSuccess(body)}。このタブは閉じて構いません`;
  } catch {
    statusElement.textContent = '失敗: サーバーに接続できません';
    setBusy(false);
  }
}

function formatSaved(body) {
  const dropped =
    body.dropped_cookies > 0
      ? `（許可ドメイン外の Cookie ${body.dropped_cookies} 件は除外）`
      : '';
  return `保存しました: Cookie ${body.cookies} 件${dropped}`;
}

function setBusy(busy) {
  saveButton.disabled = busy;
  cancelButton.disabled = busy;
}
