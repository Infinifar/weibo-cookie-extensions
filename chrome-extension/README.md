# 微博 Cookie 同步到青龙扩展

这是一个无需构建的 Chrome Manifest V3 扩展（当前版本 `1.0.0`）。它读取当前微博登录账号的 Cookie，获取当前 UID，然后按 UID 合并写入青龙环境变量 `WEIBO_CONFIGS_JSON`。原有青龙签到脚本继续负责定时签到。

## 安装

1. 打开 `chrome://extensions/`。
2. 开启“开发者模式”。
3. 点击“加载已解压的扩展程序”，选择本目录：
   `C:\Users\wucha\Desktop\weibo\chrome-extension`

## 配置

在扩展“设置”中填写：

- 青龙根地址，例如 `https://ql.example.com`；
- 青龙应用的 `Client ID`；
- 青龙应用的 `Client Secret`；
- 连接方式；选择 mTLS 时地址必须是 `https://`，客户端证书由 Chrome/系统证书库选择；
- 环境变量名，默认 `WEIBO_CONFIGS_JSON`。

扩展使用青龙 Open API：

- `GET /open/auth/token?client_id=...&client_secret=...` 获取 Token；
- `GET /open/envs/?searchValue=...` 查找环境变量；
- `PUT /open/envs/` 更新已有变量；
- `POST /open/envs/` 创建变量。

如果青龙前面还有 Nginx/mTLS，扩展的青龙地址填写 Nginx 对外地址，并确保这些 Open API 路径被转发。客户端证书应安装在 Chrome/系统证书库中，扩展不把私钥打包进代码。

## 数据行为

现有变量必须是 JSON 数组。扩展以 `uid` 为唯一键：相同 UID 更新 Cookie，不同 UID 追加账号。变量不存在、为空或值为精确的 `none` 时按空数组初始化；其他非法 JSON 或非数组内容会停止，不会覆盖原变量。

Cookie 失效后不能凭旧 Cookie 自动生成新 Cookie。重新登录、扫码或完成验证码后，微博 Cookie 发生变化，扩展会在已打开微博页面的情况下自动尝试同步；也可以手动点击同步。

扩展不会把 Cookie 输出到日志、通知或页面。青龙 Client Secret 仅保存在扩展本地存储中，请不要把扩展目录分发给不可信人员。

## 故障排除

如果出现 `Receiving end does not exist`，通常是扩展安装后原来的微博标签页还没有注入内容脚本。重新加载扩展后再次同步即可；扩展也会尝试自动注入 `content.js`。

mTLS 证书选择发生在 Chrome 的 TLS 握手层，不是 JavaScript API。扩展中的 mTLS 选项只会强制使用 HTTPS，客户端证书由 Chrome/系统证书库选择；如果有多个匹配证书，可能需要手动选择或配置 Chrome 的自动选证书策略。点击“测试连接”时没有弹窗并不一定是失败，只有测试结果才能判断握手是否成功。
