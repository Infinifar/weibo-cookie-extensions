const DEFAULT_SETTINGS = {
  qlBaseUrl: '',
  qlClientId: '',
  qlClientSecret: '',
  qlConnectionMode: 'mtls',
  envName: 'WEIBO_CONFIGS_JSON',
  envRemarks: '微博超话签到账号配置',
  autoSync: true
};

const WEIBO_COOKIE_NAMES = new Set([
  'ALF',
  'SCF',
  'SUB',
  'SUBP',
  'SSOLoginState',
  'WBPSESS',
  'XSRF-TOKEN',
  '_s_tentry',
  'login_sid_t'
]);

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function getSettings() {
  return chrome.storage.local.get(DEFAULT_SETTINGS);
}

function normalizeBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function validateSettings(settings) {
  const baseUrl = normalizeBaseUrl(settings.qlBaseUrl);
  if (!baseUrl) throw new Error('请先配置青龙 Open API 地址。');
  if (!/^https?:\/\//i.test(baseUrl)) {
    throw new Error('青龙地址必须以 http:// 或 https:// 开头。');
  }
  if (settings.qlConnectionMode === 'mtls' && !/^https:\/\//i.test(baseUrl)) {
    throw new Error('mTLS 模式必须使用 https:// 青龙地址。');
  }
  if (!settings.qlClientId || !settings.qlClientSecret) {
    throw new Error('请先配置青龙 Client ID 和 Client Secret。');
  }
  if (!settings.envName) throw new Error('环境变量名不能为空。');
  return { ...settings, qlBaseUrl: baseUrl };
}

async function ensureQlPermission(baseUrl) {
  const origin = `${new URL(baseUrl).origin}/*`;
  const allowed = await chrome.permissions.contains({ origins: [origin] });
  if (!allowed) {
    throw new Error(`扩展没有访问 ${new URL(baseUrl).origin} 的权限，请在选项页点击“授权青龙地址”。`);
  }
}

async function readJsonResponse(response, label) {
  let body;
  try {
    body = await response.json();
  } catch (_) {
    throw new Error(`${label}返回的不是 JSON（HTTP ${response.status}）。`);
  }
  if (!response.ok) {
    throw new Error(`${label}失败（HTTP ${response.status}）。`);
  }
  return body;
}

async function getQlToken(settings) {
  const url = new URL(`${settings.qlBaseUrl}/open/auth/token`);
  url.searchParams.set('client_id', settings.qlClientId);
  url.searchParams.set('client_secret', settings.qlClientSecret);

  const response = await fetch(url, {
    method: 'GET',
    cache: 'no-store'
  });
  const result = await readJsonResponse(response, '青龙 Token 获取');
  const token = result?.data?.token;
  if (result?.code !== 200 || !token) {
    throw new Error(`青龙 Token 获取失败：${result?.message || '返回内容缺少 token'}`);
  }
  return token;
}

async function qlRequest(settings, token, path, options = {}) {
  const response = await fetch(`${settings.qlBaseUrl}${path}`, {
    ...options,
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      Authorization: `Bearer ${token}`,
      ...(options.headers || {})
    },
    cache: 'no-store'
  });
  return readJsonResponse(response, `青龙 ${options.method || 'GET'} ${path}`);
}

async function findQlEnv(settings, token) {
  const path = `/open/envs/?searchValue=${encodeURIComponent(settings.envName)}`;
  const result = await qlRequest(settings, token, path);
  const envs = Array.isArray(result?.data) ? result.data : [];
  return envs.find(item => item?.name === settings.envName) || null;
}

function parseConfigs(value, envName) {
  const text = String(value ?? '').trim();
  if (!text || /^none$/i.test(text)) return [];
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`青龙变量 ${envName || DEFAULT_SETTINGS.envName} 不是合法 JSON：${error.message}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error('青龙变量必须是 JSON 数组，扩展不会覆盖非数组内容。');
  }
  return parsed;
}

function mergeAccount(value, account, envName) {
  const configs = parseConfigs(value, envName);
  const index = configs.findIndex(item => String(item?.uid || '') === account.uid);
  const next = {
    ...(index >= 0 && configs[index] ? configs[index] : {}),
    uid: account.uid,
    nickname: account.nickname || (index >= 0 ? configs[index].nickname : '') || '微博用户',
    ua: account.ua || (index >= 0 ? configs[index].ua : '') || 'Mozilla/5.0',
    cookie: account.cookie,
    updatedAt: new Date().toISOString()
  };

  if (index >= 0) configs[index] = next;
  else configs.push(next);

  return JSON.stringify(configs, null, 2);
}

async function getCookieHeader() {
  const urls = ['https://weibo.com/', 'https://www.weibo.com/'];
  const cookies = (await Promise.all(
    urls.map(url => chrome.cookies.getAll({ url }))
  )).flat();

  const unique = new Map();
  for (const cookie of cookies) {
    const key = `${cookie.storeId}|${cookie.domain}|${cookie.path}|${cookie.name}`;
    unique.set(key, cookie);
  }

  return [...unique.values()]
    .filter(cookie => cookie.value !== undefined)
    .sort((a, b) => (b.path?.length || 0) - (a.path?.length || 0))
    .map(cookie => `${cookie.name}=${cookie.value}`)
    .join('; ');
}

function isWeiboTab(tab) {
  return Boolean(tab?.id && /^https:\/\/(?:www\.)?weibo\.com\//i.test(tab.url || ''));
}

async function findWeiboTab() {
  const active = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const activeWeibo = active.find(isWeiboTab);
  if (activeWeibo) return activeWeibo;

  const tabs = await chrome.tabs.query({
    url: ['https://weibo.com/*', 'https://*.weibo.com/*']
  });
  return tabs.find(isWeiboTab) || null;
}

async function getIdentityFromTab(tabId) {
  let lastError;
  let injected = false;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      const result = await chrome.tabs.sendMessage(tabId, { type: 'GET_WEIBO_IDENTITY' });
      if (result?.ok) return result;
      throw new Error(result?.reason || '未检测到微博登录状态。');
    } catch (error) {
      lastError = error;
      if (!injected && /Receiving end does not exist/i.test(error?.message || '')) {
        try {
          await chrome.scripting.executeScript({
            target: { tabId },
            files: ['content.js']
          });
          injected = true;
        } catch (injectError) {
          lastError = injectError;
        }
      }
      await sleep(500);
    }
  }
  throw new Error(lastError?.message || '无法连接微博页面，请刷新微博标签页后重试。');
}

async function syncCurrentAccount(tabId) {
  const settings = validateSettings(await getSettings());
  await ensureQlPermission(settings.qlBaseUrl);

  const tab = tabId ? { id: tabId } : await findWeiboTab();
  if (!tab?.id) {
    throw new Error('请先打开一个微博网页标签页。');
  }

  const identity = await getIdentityFromTab(tab.id);
  const cookie = await getCookieHeader();
  if (!cookie) throw new Error('没有读取到微博 Cookie，请确认当前账号已登录。');

  const token = await getQlToken(settings);
  const env = await findQlEnv(settings, token);
  const nextValue = mergeAccount(env?.value || '', {
    uid: identity.uid,
    nickname: identity.nickname,
    ua: identity.ua,
    cookie
  }, settings.envName);

  if (env) {
    await qlRequest(settings, token, '/open/envs/', {
      method: 'PUT',
      body: JSON.stringify({
        id: env.id,
        name: settings.envName,
        value: nextValue,
        remarks: env.remarks || settings.envRemarks
      })
    });
  } else {
    await qlRequest(settings, token, '/open/envs/', {
      method: 'POST',
      body: JSON.stringify([{
        name: settings.envName,
        value: nextValue,
        remarks: settings.envRemarks
      }])
    });
  }

  await chrome.storage.local.set({
    lastSync: {
      uid: identity.uid,
      nickname: identity.nickname,
      at: new Date().toISOString()
    }
  });

  return {
    uid: identity.uid,
    nickname: identity.nickname || identity.uid,
    message: env ? '已更新青龙环境变量。' : '已创建青龙环境变量并写入当前账号。'
  };
}

async function testQlConnection() {
  const settings = validateSettings(await getSettings());
  await ensureQlPermission(settings.qlBaseUrl);
  const token = await getQlToken(settings);
  const env = await findQlEnv(settings, token);
  return {
    exists: Boolean(env),
    message: env
      ? `青龙连接成功，已找到变量 ${settings.envName}。`
      : `青龙连接成功，但尚未找到变量 ${settings.envName}。`
  };
}

async function notify(title, message) {
  try {
    await chrome.notifications.create(`weibo-${Date.now()}`, {
      type: 'basic',
      iconUrl: 'icon.svg',
      title,
      message
    });
  } catch (_) {
    // 通知权限不可用时不影响同步。
  }
}

async function syncAutomatically() {
  const settings = await getSettings();
  if (!settings.autoSync || !settings.qlBaseUrl) return;
  const tab = await findWeiboTab();
  if (!tab?.id) return;

  try {
    const result = await syncCurrentAccount(tab.id);
    await notify('微博 Cookie 已同步', `${result.nickname}（${result.uid}）`);
  } catch (error) {
    // 自动任务不打扰用户；手动同步会显示完整错误。
    console.warn('[微博 Cookie 同步]', error.message);
  }
}

async function ensureAlarms() {
  await chrome.alarms.create('weibo-cookie-health', { periodInMinutes: 60 });
}

chrome.runtime.onInstalled.addListener(ensureAlarms);
chrome.runtime.onStartup.addListener(ensureAlarms);

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'weibo-cookie-health' || alarm.name === 'weibo-cookie-sync') {
    syncAutomatically();
  }
});

chrome.cookies.onChanged.addListener(changeInfo => {
  const domain = String(changeInfo.cookie?.domain || '').replace(/^\./, '');
  if (domain !== 'weibo.com' && !domain.endsWith('.weibo.com')) return;
  if (!WEIBO_COOKIE_NAMES.has(changeInfo.cookie?.name)) return;
  getSettings().then(settings => {
    if (!settings.autoSync) return;
    chrome.alarms.create('weibo-cookie-sync', { delayInMinutes: 0.5 });
  });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'SYNC_CURRENT') {
    syncCurrentAccount(message.tabId)
      .then(result => sendResponse({ ok: true, result }))
      .catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === 'TEST_QL') {
    testQlConnection()
      .then(result => sendResponse({ ok: true, result }))
      .catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === 'OPEN_WEIBO_LOGIN') {
    chrome.tabs.create({ url: 'https://weibo.com/', active: true })
      .then(tab => sendResponse({ ok: true, tabId: tab.id }))
      .catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === 'GET_STATUS') {
    Promise.all([getSettings(), chrome.storage.local.get('lastSync')])
      .then(([settings, state]) => sendResponse({
        ok: true,
        settings: {
          configured: Boolean(settings.qlBaseUrl && settings.qlClientId && settings.qlClientSecret),
          connectionMode: settings.qlConnectionMode,
          autoSync: Boolean(settings.autoSync),
          envName: settings.envName
        },
        lastSync: state.lastSync || null
      }))
      .catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  return undefined;
});
