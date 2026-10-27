# koishi-plugin-deepseek-keyusage

在 QQ 里查 DeepSeek 账号的余额、花费和 Token 用量。**账号 / Key 两级**：一个 userToken 是一个账号，一个账号下可以绑多个 Key；只登录账号不绑 Key 也能查账号总用量。

```text
DeepSeek API用量

账号：主号
  余额 ¥24.57（赠金 ¥0.00 / 充值 ¥24.57） · 累计花费 ¥38.26 · 累计 Token 1,130,515,780
  今日花费 ¥0.940 · 今日 Token 11,467,124 · Key 3 个

  1. 示例A · sk-abcde**1234 · 今日 ¥0.930 · 累计 ¥38.26
  2. 备用 · sk-fghij**5678 · 今日 ¥0.010 · 累计 ¥1.20
  （账号里还有 1 个 Key 没绑定）

发送 dsu {序号} 看单个 Key 的完整明细。
```

`dsu 1` 才输出单个 Key 的完整明细（余额、累计/今日、输入命中/未命中、输出、请求数、命中率）。

## 用法

```text
dsu                           # 账号总览 + 已绑定 Key 列表
dsu {序号/名字}                # 单个 Key 的完整明细（例：dsu 1）
dsu {账号备注}                 # 只看一个账号
dsu help                      # 全部用法

dsu login {备注名}              # 读 bot 本机浏览器，绑定 / 切换账号
dsu login {userToken} {备注名}   # 直接粘贴 userToken
dsu logout {账号备注}           # 退出账号，不带参数就退当前账号
dsu add {Key尾号} {备注名}       # 用 Key 后四位绑定，不用发完整 Key
dsu unbind {序号/名字}          # 解绑一个；不带参数解绑全部（账号保留）
dsu keys {账号备注}             # 列出账号下的全部 Key（含没绑定的）
dsu account list              # 账号备注列表
dsu account rename {旧} {新}    # 改账号备注
```

`{...}` 是「要你填的值」，说明里写了「不带参数」的就可以省略。

- 空格写法和点号写法等价：`dsu add` = `dsu.add`，`dsu login` = `dsu.login`。
- 参数顺序随意：`dsu login 主号 {userToken}` 和 `dsu login {userToken} 主号` 都行；任何位置出现像 userToken 的长串都会自动当 Token，**不会**被当成备注名。
- 备注名里万一带进 token，写入和读取时都会自动清掉，聊天里不会回显。
- 只发 `dsu add`（或 `dsu.add`）时，机器人会接着问你要 Key；只发 `dsu login` 且本机浏览器没有登录态时，会问你要 userToken。
- `dsu add` 的 Key 可以用：后四位、完整 `sk-...`、**Key 名字**、或它的 **ID 前缀**（名字带空格就加引号，比如 `dsu add "DeepSeek Harness"`）。
- 管理员：`dsu all {页码}`、`dsu key {名字}`、`dsu refresh`；诊断用 `dsu whoami`。

### 快捷回复（点一下就填好指令）

QQ 官方机器人的消息里带内联指令（`qqbot-cmd-input`），点一下就把指令填进输入框：

```text
账号：主号
• 余额 ¥36.05（赠金 ¥0.00 / 充值 ¥36.05） · 累计花费 ¥147.95 · 累计 Token 2,869,029,369
• 今日花费 ¥9.45 · 今日 Token 152,326,138 · Key 5 个
还没有绑定 Key，快捷绑定
```

- 「快捷绑定」→ 填 `/dsu add`
- 每个已绑定 Key 后面的「详情」→ 填 `/dsu 1` / `/dsu 2` …
- 底部一行的「全部 Key / 快捷绑定 / 刷新」→ `/dsu keys` / `/dsu add` / `/dsu`

填进去的指令默认带 `/` 前缀（`commandPrefix` 可改，留空就不加），点完只填入输入框、不自动发送；想把键盘按钮也打开就设 `qqKeyboard: true`，想让按钮直接发送就设 `qqButtonEnter: true`。

### 群聊里会被 @ 到

群里回复时默认 @ 调用者并引用原消息（`replyAt` / `replyQuote` 可关），避免刷屏时看不出在回谁。QQ 官方机器人的 @ 用的是 markdown 里的 `<qqbot-at-user>`，引用走 `message_reference`。

## 看账号下所有 Key（不用开网页）

`dsu keys` 会把账号里的**每个 Key**都列出来，包括还没绑定的，带今日 / 累计花费；没绑定的那一行后面有「绑定」，点一下就是 `dsu add {尾号}`：

```text
账号下的全部 Key

账号：主号 · 4 个 Key
  1. 示例A · sk-abcde**1234 · 今日 ¥0.930 · 累计 ¥38.26 · 已绑定
  2. 备用 · sk-fghij**5678 · 今日 ¥0.010 · 累计 ¥1.20
  3. DeepSeek Harness 532b6cac-… · 今日 ¥5.78 · 累计 ¥38.38
     没有脱敏 Key，按名字或 ID 绑：dsu add "DeepSeek Harness" / dsu add 532b6cac

没绑定的 Key 用 dsu add {Key尾号} 绑定，之后就能在 dsu 里看明细。
```

**想看某个程序的用量**（比如 DeepSeek Harness、某个脚本）？它在平台上用的那个 Key 就是它的用量单元：先用 `dsu keys` 找到它（按名字或用量判断），再 `dsu add {Key尾号}` 绑上，`dsu` 里就会单独列出这个 Key 的今日 / 累计明细。

## 安装

需要 Koishi 的 **database** 服务（Koishi Desktop 默认带 SQLite）。

```bash
npm install koishi-plugin-deepseek-keyusage
```

```yaml
plugins:
  deepseek-keyusage:
    autoReadToken: true
```

## 配置

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `userToken` | 空 | 旧版全局 Token，仅用于迁移；新绑定用 `dsu login` |
| `autoReadToken` | `true` | 没有 Token 时自动读本机 Edge / Chrome |
| `apiBaseUrl` | `https://platform.deepseek.com` | 平台接口地址 |
| `officialBaseUrl` | `https://api.deepseek.com` | 官方接口，只用来校验完整 Key |
| `timeZone` | `Asia/Shanghai` | 「今日」的边界 |
| `currency` | `CNY` | 展示币种，可选 `USD` |
| `cacheTtl` | `60` | 结果缓存秒数 |
| `cooldown` | `10` | 同一用户查询冷却秒数 |
| `adminAuthority` | `4` | Koishi 权限等级达到该值算管理员 |
| `adminUsers` | `[]` | 管理员白名单，如 `qq:OPENID`、`onebot:123456` |
| `allowGroupBind` | `true` | 允许群聊绑定（QQ 官方机器人通常没有私聊） |
| `autoRecallInGroup` | `true` | 群里发过 Token / 完整 Key 后自动撤回那条消息 |
| `showBalance` | `true` | 是否给普通用户看余额 |
| `qqKeyboard` | `false` | 消息底部再加一排键盘按钮（「详情 / 快捷绑定」内联按钮已经够用） |
| `qqButtonEnter` | `false` | 点按钮直接发送（关掉=只填进输入框） |
| `commandPrefix` | `/` | 内联按钮填进去的指令前缀；bot 没配 `/` 就留空 |
| `replyAt` | `true` | 群里回复时 @ 调用者 |
| `replyQuote` | `true` | 群里回复时引用原消息 |
| `aliases` | `['额度']` | 主指令别名 |
| `maxKeys` | `30` | 管理员总览最多展示多少个 Key |
| `maxBindings` | `5` | 每人最多绑定多少个 Key |
| `allPageSize` | `10` | `dsu.all` 每页多少个 Key |
| `requestTimeout` | `10000` | 请求超时（毫秒） |
| `debug` | `false` | 请求日志 |

## 原理

DeepSeek 官方 API 只有账号级余额接口，没有按 Key 的用量接口。本插件用的是开放平台网页端的接口，认证方式是 `Authorization: Bearer <userToken>`（浏览器 localStorage 里的登录态）：

| 接口 | 用途 |
| --- | --- |
| `GET /api/v0/users/get_api_keys` | Key 列表（`tracking_id`、名称、脱敏 Key） |
| `GET /api/v0/users/get_user_summary` | 余额、累计花费 |
| `GET /api/v0/usage/by_api_key/amount` | 按 Key × 模型 × 天的 Token |
| `GET /api/v0/usage/by_api_key/cost` | 按 Key × 天的真实扣费 |

平台单次查询上限 31 天且 `end` 为开区间，插件会自动分段合并。余额是账号级的，花费和 Token 按 Key 分开。

> 这不是官方承诺的公开 API，平台改版时可能需要更新 `src/api/client.ts`；`userToken` 过期后重新 `dsu login` 即可。

**手动取 userToken**：登录 platform.deepseek.com → `F12` → `Application` → `Local Storage` → 复制 `userToken` 的值。

## 安全

- 只保存 `tracking_id`、名称和脱敏 Key（`sk-xxxxx**abcd`）；完整 Key 只在绑定那一刻用于校验，随后丢弃
- 可以只发 Key 后四位，不需要在群里发完整 Key
- 群聊可用；发过 Token / 完整 Key 的消息会自动撤回（`autoRecallInGroup`）
- `userToken` 等同于账号登录态，别外传；怀疑泄露去平台「退出所有设备」

## 开发

```bash
npm install
npm test        # 构建 + 112 个测试
npm run build   # 输出到 lib/
```

## License

MIT
