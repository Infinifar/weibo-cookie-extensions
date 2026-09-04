/**
 * 青龙脚本：微博超话签到（Node.js 版本 · 含运行统计）
 * 环境变量：
 *   WEIBO_CONFIGS_JSON -> JSON 数组 [{nickname, ua, cookie}]
 *   WB_DELAY_RANGE -> "min,max" (秒)，可选
 */

const axios = require('axios');

/** 延迟函数（毫秒） */
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** 随机延迟秒数转毫秒 */
const randomDelay = (min, max) =>
  (Math.floor(Math.random() * (max - min + 1)) + min) * 1000;

/** 安全日志输出 */
const safeLog = (...args) => {
  try {
    console.log(...args);
  } catch {
    console.log(args.join(' '));
  }
};

/** 青龙通知封装 */
function notify(title, msg) {
  try {
    if (typeof QLAPI !== 'undefined' && QLAPI.notify) {
      QLAPI.notify(title, msg);
    } else {
      console.log(`\n===== 通知标题 =====\n${title}`);
      console.log(`===== 通知内容 =====\n${msg}`);
    }
  } catch (e) {
    console.log('[通知] 调用 QLAPI.notify 失败:', e);
    console.log(msg);
  }
}

/** 解析青龙中的多账号配置，避免未初始化值导致任务异常 */
function parseConfigs(jsonText) {
  const text = String(jsonText ?? '').trim();
  if (!text || /^none$/i.test(text)) return [];

  const configs = JSON.parse(text);
  if (!Array.isArray(configs)) {
    throw new Error('WEIBO_CONFIGS_JSON 必须是 JSON 数组');
  }
  return configs;
}

/** 微博用户类 */
class WeiboUser {
  constructor(nickname, cookie, ua) {
    this.nickname = nickname;
    this.cookie = cookie;
    this.ua = ua;
    this.uid = '';
    this.headers = {
      'User-Agent': ua,
      'Accept': 'application/json, text/plain, */*',
      'Accept-Encoding': 'gzip, deflate, br, zstd',
      'Accept-Language': 'zh-CN,zh;q=0.9',
      'Referer': 'https://weibo.com/',
      'X-Requested-With': 'XMLHttpRequest',
      'Cookie': cookie,
    };
    this.client = axios.create({
      timeout: 10000,
      headers: this.headers,
      httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false }),
    });
  }

  async updateCookie() {
    try {
      const resp = await this.client.get('https://weibo.com');
      this.uid = resp.headers['x-log-uid'] || '';
      if (resp.headers['set-cookie']) {
        const xsrf = resp.headers['set-cookie']
          .find(c => c.includes('XSRF-TOKEN'));
        if (xsrf) {
          this.headers['x-xsrf-token'] = xsrf.split('=')[1].split(';')[0];
        }
      }
    } catch (e) {
      safeLog(`[${this.nickname}] 访问 weibo.com 失败: ${e.message}`);
    }
  }

  async updateUserInfo() {
    if (!this.uid) return;
    try {
      const resp = await this.client.get(
        `https://weibo.com/ajax/profile/info?uid=${this.uid}`
      );
      if (resp.data.ok === 1) {
        this.nickname = resp.data.data.user.screen_name || this.nickname;
      }
    } catch (e) {
      safeLog(`[${this.nickname}] update_user_info 失败: ${e.message}`);
    }
  }

  async getChaohuaList() {
    const list = [];
    const headers = { ...this.headers, referer: `https://weibo.com/u/page/follow/${this.uid}/231093_-_chaohua` };

    const getPage = async (page) => {
      try {
        const resp = await this.client.get(
          'https://weibo.com/ajax/profile/topicContent',
          { params: { tabid: '231093_-_chaohua', page }, headers }
        );
        const data = resp.data;
        if (data.ok === 1 && data.data.list) {
          for (const li of data.data.list) {
            if (li.oid?.includes(':')) {
              list.push({ title: li.title, id: li.oid.split(':')[1] });
            }
          }
          return data.data.max_page || 1;
        }
      } catch (e) {
        safeLog(`[${this.nickname}] get_one_page 请求或解析失败: ${e.message}`);
      }
      return 0;
    };

    const maxPage = await getPage(1);
    for (let i = 2; i <= maxPage; i++) {
      await getPage(i);
      await sleep(1000 + Math.random() * 1000);
    }
    return list;
  }

  async chaohuaCheckin(id, title) {
    const url = 'https://weibo.com/p/aj/general/button';
    const headers = { ...this.headers, referer: `https://weibo.com/p/${id}/super_index` };
    const params = {
      ajwvr: '6',
      api: 'http://i.huati.weibo.com/aj/super/checkin',
      texta: '签到',
      textb: '已签到',
      status: '0',
      id,
      location: 'page_100808_super_index',
      timezone: 'GMT+0800',
      lang: 'zh-cn',
      plat: 'Win32',
      ua: this.ua,
      screen: '2560*1440',
      __rnd: Date.now(),
    };

    try {
      const resp = await this.client.get(url, { headers, params });
      const data = resp.data;
      if (data.code === '100000') {
        // ✅ 微博返回的数据里 msg 已包含“经验值+6”，无需再拼接
        const msg = data.data.tipMessage || '签到成功';
        const rankMatch = data.data.alert_title?.match(/\d+/);
        const rank = rankMatch ? rankMatch[0] : '-';
        return { title, success: true, msg: `${title}: ${msg} 排名${rank}` };
      } else if (data.code === '382004') {
        // 已签到的情况
        return { title, success: true, msg: `${title}: ${data.msg}` };
      } else {
        // 其他未知返回
        return { title, success: false, msg: `${title}: 未知返回 ${JSON.stringify(data)}` };
      }
    } catch (e) {
      return { title, success: false, msg: `${title}: 签到失败 (${e.message})` };
    }
  }


  async run(delayRange) {
    const start = Date.now();
    await this.updateCookie();
    await this.updateUserInfo();
    const results = [];

    const chaohuaList = await this.getChaohuaList();
    if (!chaohuaList.length) {
      results.push({ success: false, msg: '未获取到超话列表，请检查 Cookie 是否过期。' });
      return { results, summary: this.formatSummary(results, start) };
    }

    for (const item of chaohuaList) {
      const delay = randomDelay(delayRange[0], delayRange[1]);
      safeLog(`[${this.nickname}] 延迟 ${delay / 1000} 秒后签到 ${item.title} ...`);
      await sleep(delay);
      const res = await this.chaohuaCheckin(item.id, item.title);
      results.push(res);
    }

    return { results, summary: this.formatSummary(results, start) };
  }

  formatSummary(results, startTime) {
    const total = results.length;
    const successCount = results.filter(r => r.success).length;
    const failCount = total - successCount;
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    return `共签到 ${total} 个超话，成功 ${successCount}，失败 ${failCount}，耗时 ${duration} 秒`;
  }
}

/** 主函数 */
(async () => {
  const startAll = Date.now();
  const jsonText = process.env.WEIBO_CONFIGS_JSON;
  const delayStr = process.env.WB_DELAY_RANGE || '1,3';

  if (!jsonText) {
    notify('微博超话签到', '未检测到 WEIBO_CONFIGS_JSON 环境变量');
    return;
  }

  let configs;
  try {
    configs = parseConfigs(jsonText);
  } catch (e) {
    notify('微博超话签到', `JSON 解析失败: ${e.message}`);
    return;
  }

  if (!configs.length) {
    notify('微博超话签到', 'WEIBO_CONFIGS_JSON 尚未初始化账号，扩展同步成功后再运行任务。');
    return;
  }

  let delayRange = [1, 3];
  try {
    const parts = delayStr.split(',').map(x => parseInt(x.trim(), 10));
    if (parts.length === 2) delayRange = parts;
  } catch (_) {}

  const allResults = [];
  for (const conf of configs) {
    const nickname = conf.nickname || '未命名用户';
    const ua = conf.ua || 'Mozilla/5.0';
    const cookie = conf.cookie || '';
    safeLog(`\n==== 开始用户 ${nickname} ====`);
    const user = new WeiboUser(nickname, cookie, ua);
    const { results, summary } = await user.run(delayRange);
    const text = results.map(r => r.msg).join('\n');
    allResults.push(`【${nickname}】\n${summary}\n${text}`);
    await sleep(randomDelay(1, 3));
  }

  const durationAll = ((Date.now() - startAll) / 1000).toFixed(1);
  const nowTime = new Date().toLocaleString('zh-CN', { hour12: false });
  const fullMsg = allResults.join('\n\n') + `\n\n=== 总耗时：${durationAll} 秒 ===`;
  notify(`微博超话签到结果 - ${nowTime}`, fullMsg);
})();
