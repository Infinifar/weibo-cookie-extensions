const DEFAULTS = {
  qlBaseUrl: '',
  qlClientId: '',
  qlClientSecret: '',
  qlConnectionMode: 'mtls',
  envName: 'WEIBO_CONFIGS_JSON',
  envRemarks: '微博超话签到账号配置',
  autoSync: true
};

const $ = selector => document.querySelector(selector);

function getForm() {
  return {
    qlBaseUrl: $('#qlBaseUrl').value.trim().replace(/\/+$/, ''),
    qlClientId: $('#qlClientId').value.trim(),
    qlClientSecret: $('#qlClientSecret').value.trim(),
    qlConnectionMode: $('#qlConnectionMode').value,
    envName: $('#envName').value.trim(),
    envRemarks: $('#envRemarks').value.trim(),
    autoSync: $('#autoSync').checked
  };
}

function setResult(text, error = false) {
  $('#result').textContent = text;
  $('#result').style.color = error ? '#d93025' : '#188038';
}

async function load() {
  const settings = await chrome.storage.local.get(DEFAULTS);
  $('#qlBaseUrl').value = settings.qlBaseUrl;
  $('#qlClientId').value = settings.qlClientId;
  $('#qlClientSecret').value = settings.qlClientSecret;
  $('#qlConnectionMode').value = settings.qlConnectionMode;
  $('#envName').value = settings.envName;
  $('#envRemarks').value = settings.envRemarks;
  $('#autoSync').checked = Boolean(settings.autoSync);
}

async function save() {
  const settings = getForm();
  if (!settings.qlBaseUrl || !settings.qlClientId || !settings.qlClientSecret) {
    throw new Error('青龙地址、Client ID、Client Secret 都不能为空。');
  }
  new URL(settings.qlBaseUrl);
  await chrome.storage.local.set(settings);
}

async function requestQlPermission() {
  const baseUrl = getForm().qlBaseUrl;
  if (!baseUrl) throw new Error('请先填写青龙地址。');
  const origin = `${new URL(baseUrl).origin}/*`;
  const granted = await chrome.permissions.request({ origins: [origin] });
  if (!granted) throw new Error('未获得青龙地址访问权限。');
  setResult(`已授权访问 ${new URL(baseUrl).origin}`);
}

$('#grant').addEventListener('click', async () => {
  try { await requestQlPermission(); } catch (error) { setResult(error.message, true); }
});

$('#save').addEventListener('click', async () => {
  try {
    await save();
    setResult('设置已保存。');
  } catch (error) {
    setResult(error.message, true);
  }
});

$('#test').addEventListener('click', async () => {
  const button = $('#test');
  button.disabled = true;
  try {
    await save();
    const response = await chrome.runtime.sendMessage({ type: 'TEST_QL' });
    if (!response?.ok) throw new Error(response?.error || '测试失败');
    setResult(response.result.message);
  } catch (error) {
    setResult(error.message, true);
  } finally {
    button.disabled = false;
  }
});

load();
