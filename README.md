# koishi-plugin-deepseek-keyusage

[![npm](https://img.shields.io/npm/v/koishi-plugin-deepseek-keyusage)](https://www.npmjs.com/package/koishi-plugin-deepseek-keyusage)
[![downloads](https://img.shields.io/npm/dm/koishi-plugin-deepseek-keyusage)](https://www.npmjs.com/package/koishi-plugin-deepseek-keyusage)
[![license](https://img.shields.io/npm/l/koishi-plugin-deepseek-keyusage)](LICENSE)
[![koishi](https://img.shields.io/badge/koishi-%5E4.18-8a2be2)](https://koishi.chat)
[![platform](https://img.shields.io/badge/platform-qq%20%7C%20qqguild%20%7C%20onebot-4a90d9)](https://koishi.chat)

在 QQ 里查 DeepSeek 账号的余额、花费和 Token 用量。

官方 API 只提供账号级的余额，没有按 Key 的用量接口，想知道「哪个 Key 今天烧了多少」只能自己上平台翻。这个插件把那套网页端接口包了一层：绑定一次账号，群里发个 `dsu` 就能看。

```text
DeepSeek API用量

账号：主号
  余额 ¥24.57（赠金 ¥0.00 / 充值 ¥24.57） · 累计花费 ¥38.26 · 累计 Token 1,130,515,780
  今日花费 ¥0.940 · 今日 Token 11,467,124 · Key 3 个

  1. 示例A · sk-abcde**1234 · 今日 ¥0.930 · 累计 ¥38.26 · 详情
  2. 备用 · sk-fghij**5678 · 今日 ¥0.010 · 累计 ¥1.20 · 详情

更新于：2026-10-27 14:39
```

一个 userToken 算一个账号，账号下能绑多个 Key；只登录账号不绑 Key 也能看账号总用量。

QQ 官方机器人里「详情 / 绑定 / 快捷绑定」是内联按钮，点一下就把 `/dsu 1`、`/dsu add` 填进输入框，不用自己敲。

## 安装

需要 database 服务（Koishi Desktop 自带 SQLite）。

```bash
npm i koishi-plugin-deepseek-keyusage
```

`qq` / `qqguild` / `onebot` 都能用。`qq`（官方机器人，按钮依赖 [adapter-qq-crack](https://www.npmjs.com/package/koishi-plugin-adapter-qq-crack)）功能最全：markdown、内联按钮、发 token 自动撤回、引用；`onebot`、`qqguild` 走纯文本，其他平台自动回退纯文本。

## 用法

```text
dsu                        账号总览
dsu 1                      某个 Key 的完整明细
dsu 主号                    只看一个账号

dsu login 主号               读本机浏览器登录，绑定账号
dsu login {userToken} 主号   或者直接粘 userToken
dsu logout                 退出当前账号
dsu add {尾号} 主号          绑 Key，给尾号就行不用发完整 Key
dsu unbind 1               解绑某个 Key（不带参数解绑全部）
dsu keys                   列出账号下所有 Key，含没绑定的

dsu account list           账号备注列表
dsu account rename 旧 新     改账号备注
dsu help                   全部用法
```

几个顺手的地方：

- `dsu add` 后面可以给 Key 尾号、完整 Key、Key 名字或者 ID 前缀；名字带空格就用引号包起来
- 只发 `dsu add` 或 `dsu login`，机器人会先问你要参数，下一条直接发就行
- `dsu login` 的两个参数顺序随意，混了也不会把 token 当备注名存下来
- 管理员：`dsu all [页码]`、`dsu key 名字`、`dsu refresh`、`dsu whoami`

## 配置

| 选项 | 默认 | 说明 |
| --- | --- | --- |
| `autoReadToken` | `true` | 没有 token 时自动读本机 Edge / Chrome |
| `timeZone` / `currency` | `Asia/Shanghai` / `CNY` | 「今日」的边界、展示币种 |
| `cacheTtl` / `cooldown` | `60` / `10` | 缓存秒数 / 查询冷却秒数 |
| `adminAuthority` / `adminUsers` | `4` / `[]` | 管理员判定（权限等级 + 白名单） |
| `allowGroupBind` / `autoRecallInGroup` | `true` | 允许群聊绑定 / 发过 token 自动撤回 |
| `commandPrefix` | `/` | 内联按钮里的指令前缀 |
| `replyAt` / `replyQuote` | `true` | 群里 @ 调用者 / 引用原消息 |
| `qqKeyboard` / `qqButtonEnter` | `false` | 底部键盘按钮 / 点了直接发送 |
| `maxBindings` / `maxKeys` | `5` / `30` | 数量上限 |

`userToken`、`apiBaseUrl`、`requestTimeout`、`debug` 这些一般不用动。

## 已知问题

- 平台单次查询上限 31 天，查很久以前的量会多打几次请求（插件会自动分段合并）
- QQ 官方机器人的 markdown 不支持表格，所以明细都是列表
- 接口不是官方公开的，平台改版可能需要跟着改，接口层都在 `src/api/client.ts`

## 安全

- 只存 `tracking_id`、名称和脱敏 Key，完整 Key 只在绑定那一刻校验一次，随后丢弃
- 普通用户只能看到自己绑的账号；管理员用 `dsu all` 能看全部，不想被别人看到就把 `adminUsers` 只留自己
- `userToken` 等同账号登录态，别外传；怀疑泄露就去平台「退出所有设备」

## License

MIT © [xjkoharu](https://github.com/xjkoharu)
