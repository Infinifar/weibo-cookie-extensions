# 微博 Cookie Extensions

一个用于将当前微博账号 Cookie 按 UID 同步到青龙环境变量的 Chrome 扩展，并配套微博超话签到青龙脚本。

当前版本：`1.0.0`

## 项目结构

- `chrome-extension/`：Chrome Manifest V3 扩展，无需构建即可加载。
- `weibo_chaohua.js`：青龙定时任务脚本，读取 `WEIBO_CONFIGS_JSON` 执行微博超话签到。

## 安装扩展

1. 打开 Chrome 的 `chrome://extensions/`。
2. 开启右上角“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择本项目中的 `chrome-extension` 文件夹。

## 配置青龙

打开扩展设置，填写：

- 青龙对外地址，例如 `https://ql.example.com`；
- 青龙应用的 `Client ID` 和 `Client Secret`；
- 连接方式，使用 mTLS 时必须填写 HTTPS 地址；
- 环境变量名，默认是 `WEIBO_CONFIGS_JSON`。

扩展通过青龙 Open API 获取 Token，并查找、更新或创建指定环境变量。使用 Nginx mTLS 时，将扩展地址配置为 Nginx 对外地址，并确保相关 Open API 路径正常转发。

客户端证书由 Chrome/系统证书库在 TLS 握手时处理，扩展不会读取、保存或打包私钥。若 Chrome 安装了多个匹配证书，可根据实际环境配置浏览器的自动选证书策略。

## Cookie 同步规则

- 当前微博页面用于确定当前登录用户 UID。
- `WEIBO_CONFIGS_JSON` 使用 JSON 数组保存多账号配置。
- 相同 UID 更新 Cookie，不同 UID 追加账号，避免不同用户互相覆盖。
- 环境变量为空、不存在或值为精确的 `none` 时按空数组初始化。
- 已有内容如果是非法 JSON 或非数组，扩展会停止同步，不会覆盖原数据。
- Cookie 变化后，扩展会尝试自动同步；也可以在弹窗中手动同步。
- Cookie 不会输出到日志、通知或页面。

Cookie 失效后无法使用旧 Cookie 静默生成新 Cookie。需要在微博重新登录、扫码或完成验证，新的 Cookie 产生变化后扩展才能同步。

## 青龙脚本

将 `weibo_chaohua.js` 添加为青龙定时任务，并确保脚本能读取：

```text
WEIBO_CONFIGS_JSON
```

脚本会兼容扩展写入的 `uid`、`nickname`、`ua`、`cookie` 和 `updatedAt` 字段，其中 `uid` 与 `updatedAt` 仅用于扩展侧账号识别和同步记录。

## 安全提示

- Client Secret 保存在浏览器扩展本地存储中，请只在可信设备和可信浏览器配置扩展。
- 不要将 Cookie、Client Secret、客户端证书或私钥提交到 Git 仓库。
- 仓库建议保持私有，并通过 Nginx mTLS、访问控制和 HTTPS 保护青龙 Open API。

