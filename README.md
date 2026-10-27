# koishi-plugin-deepseek-keyusage

在 QQ 里查 DeepSeek 账号的余额、花费、Token 用量。一个 userToken = 一个账号，账号下可绑多个 Key；只登录账号不绑 Key 也能看账号总用量。

```text
DeepSeek API用量

账号：主号
  余额 ¥24.57（赠金 ¥0.00 / 充值 ¥24.57） · 累计花费 ¥38.26 · 累计 Token 1,130,515,780
  今日花费 ¥0.940 · 今日 Token 11,467,124 · Key 3 个

  1. 示例A · sk-abcde**1234 · 今日 ¥0.930 · 累计 ¥38.26 · 详情
  2. 备用 · sk-fghij**5678 · 今日 ¥0.010 · 累计 ¥1.20 · 详情

更新于：2026-10-27 14:39
```

`dsu {序号}` 看单个 Key 的完整明细（输入命中/未命中、输出、请求数、命中率）。QQ 官方机器人里「详情 / 绑定 / 快捷绑定」是内联按钮，点一下把 `/dsu 1`、`/dsu add` 填进输入框。

## 用法

```text
dsu                             账号总览 + 已绑定 Key
dsu {序号/名字}                  单个 Key 的完整明细
dsu {账号备注}                   只看一个账号

dsu login {备注名}                读 bot 本机浏览器，绑定 / 切换账号
dsu login {userToken} {备注名}    直接粘贴 userToken
dsu logout {账号备注}             退出账号（不带参数就退当前账号）
dsu add {Key尾号} {备注名}         绑定 Key；也可以发完整 Key、Key 名字、ID 前缀
dsu unbind {序号/名字}            解绑一个（不带参数解绑全部，账号保留）
dsu keys {账号备注}               列出账号下全部 Key（含没绑定的）

dsu account list                账号备注列表
dsu account rename {旧} {新}      改账号备注
dsu help                        全部用法
```

- `{...}` 是要你填的值；说明里写「不带参数」的可以省略。
- 空格写法和点号写法等价：`dsu add` = `dsu.add`。
- `dsu login` 两个参数顺序随意；只发 `dsu add` / `dsu login` 时会先追问参数。
- 管理员：`dsu all {页码}`、`dsu key {名字}`、`dsu refresh`、`dsu whoami`。

## 安装

需要 Koishi 的 **database** 服务（Koishi Desktop 自带 SQLite）。

```bash
npm install koishi-plugin-deepseek-keyusage
```

## 配置

| 配置 | 默认 | 说明 |
| --- | --- | --- |
| `autoReadToken` | `true` | 没有 Token 时自动读本机 Edge / Chrome |
| `userToken` | 空 | 旧版全局 Token，仅用于迁移 |
| `timeZone` / `currency` | `Asia/Shanghai` / `CNY` | 「今日」的边界、展示币种 |
| `cacheTtl` / `cooldown` | `60` / `10` | 缓存秒数 / 查询冷却秒数 |
| `adminAuthority` / `adminUsers` | `4` / `[]` | 管理员判定（权限等级 + 白名单） |
| `allowGroupBind` / `autoRecallInGroup` | `true` | 群聊可绑定 / 发过 Token 自动撤回 |
| `showBalance` | `true` | 普通用户能否看余额 |
| `commandPrefix` | `/` | 内联按钮填进去的指令前缀 |
| `replyAt` / `replyQuote` | `true` | 群里回复 @ 调用者 / 引用原消息 |
| `qqKeyboard` / `qqButtonEnter` | `false` | 底部键盘按钮 / 点了直接发送 |
| `maxBindings` / `maxKeys` / `allPageSize` | `5` / `30` / `10` | 数量上限 |
| `aliases` | `['额度']` | 主指令别名 |
| `requestTimeout` / `debug` | `10000` / `false` | 超时（毫秒）/ 调试日志 |

## 原理

DeepSeek 官方只有账号级余额接口，没有按 Key 的用量接口。插件用的是开放平台网页端接口，认证方式是 `Authorization: Bearer {userToken}`（浏览器 localStorage 里的登录态）：

| 接口 | 用途 |
| --- | --- |
| `users/get_api_keys` | Key 列表（tracking_id、名称、脱敏 Key） |
| `users/get_user_summary` | 余额、累计花费 |
| `usage/by_api_key/amount` | 按 Key × 模型 × 天的 Token |
| `usage/by_api_key/cost` | 按 Key × 天的真实扣费 |

平台单次查询上限 31 天，插件自动分段合并。余额是账号级的，花费和 Token 按 Key 分开。

> 这不是官方公开 API，平台改版可能要改 `src/api/client.ts`；`userToken` 过期重新 `dsu login` 即可。
>
> 手动取 token：platform.deepseek.com → F12 → Application → Local Storage → `userToken`。

## 安全

- 只保存 `tracking_id`、名称和脱敏 Key；完整 Key 只在绑定那一刻校验，随后丢弃
- 普通用户只能看到自己绑的账号；管理员用 `dsu all` 能看全部（不想让别人看就把 `adminUsers` 只留自己）
- `userToken` 等同账号登录态，别外传；怀疑泄露去平台「退出所有设备」

## License

MIT
