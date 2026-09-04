const $ = selector => document.querySelector(selector);

function showResult(text, error = false) {
  const el = $('#result');
  el.textContent = text;
  el.style.color = error ? '#d93025' : '#188038';
}

function send(message) {
  return chrome.runtime.sendMessage(message);
}

async function loadStatus() {
  const response = await send({ type: 'GET_STATUS' });
  if (!response?.ok) {
    $('#status').textContent = response?.error || '读取状态失败';
    return;
  }

  const configured = response.settings.configured;
  const last = response.lastSync;
  const connection = $('#connection');
  connection.className = 'badge';
  connection.textContent = configured
    ? (response.settings.connectionMode === 'mtls' ? 'mTLS' : '已配置')
    : '未配置';
  if (configured) connection.classList.add(response.settings.connectionMode === 'mtls' ? 'mtls' : 'ok');
  $('#status').textContent = configured
    ? `变量：${response.settings.envName}\n连接：${response.settings.connectionMode === 'mtls' ? 'HTTPS / mTLS' : response.settings.connectionMode.toUpperCase()}\n` +
      (last ? `上次同步：${last.nickname || last.uid}` : '尚未同步当前账号')
    : '请先打开设置，配置青龙 Client ID/Secret。';
}

async function runAction(button, action) {
  button.disabled = true;
  showResult('处理中…');
  try {
    const response = await action();
    if (!response?.ok) throw new Error(response?.error || '操作失败');
    showResult(response.result?.message || '操作成功');
    await loadStatus();
  } catch (error) {
    showResult(error.message, true);
  } finally {
    button.disabled = false;
  }
}

$('#sync').addEventListener('click', () => runAction($('#sync'), () => send({ type: 'SYNC_CURRENT' })));
$('#test').addEventListener('click', () => runAction($('#test'), () => send({ type: 'TEST_QL' })));
$('#login').addEventListener('click', () => send({ type: 'OPEN_WEIBO_LOGIN' }));
$('#options').addEventListener('click', () => chrome.runtime.openOptionsPage());

loadStatus();
