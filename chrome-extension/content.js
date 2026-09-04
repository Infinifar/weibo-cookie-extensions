const HOME_URL = `${location.origin}/`;

async function getCurrentIdentity() {
  const homeResponse = await fetch(HOME_URL, {
    credentials: 'include',
    cache: 'no-store',
    redirect: 'follow'
  });

  const html = await homeResponse.text();
  let uid = homeResponse.headers.get('x-log-uid') || '';

  if (!uid) {
    const uidMatch = html.match(/(?:"uid"|\\"uid\\")\s*[:=]\s*["']?(\d{5,})/);
    uid = uidMatch ? uidMatch[1] : '';
  }

  if (!uid) {
    return {
      ok: false,
      reason: '未检测到微博登录状态，请先在当前标签页登录微博。'
    };
  }

  let nickname = '';
  try {
    const infoResponse = await fetch(
      `${location.origin}/ajax/profile/info?uid=${encodeURIComponent(uid)}`,
      { credentials: 'include', cache: 'no-store' }
    );
    const info = await infoResponse.json();
    if (info?.ok === 1) {
      nickname = info.data?.user?.screen_name || '';
    }
  } catch (_) {
    // UID 已经足够完成同步，昵称获取失败不阻断流程。
  }

  return {
    ok: true,
    uid: String(uid),
    nickname,
    ua: navigator.userAgent
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'GET_WEIBO_IDENTITY') return undefined;

  getCurrentIdentity()
    .then(sendResponse)
    .catch(error => sendResponse({
      ok: false,
      reason: error?.message || '读取微博登录状态失败。'
    }));

  return true;
});
