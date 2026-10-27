# koishi-plugin-deepseek-keyusage

在 QQ 里查 DeepSeek 账号的用量：**余额、累计花费、今日花费、Token 明细（缓存命中 / 未命中 / 输出）、缓存命中率**。

两级模型：**一个账号（userToken）= 一个平台账号，一个账号下可以绑定多个 Key**。

- 只要绑定了账号，**即使一个 Key 都没绑定，也能查账号总用量**；
- 绑定了 Key，就在账号总用量下面列出每个已绑定 Key 的明细。

示例输出（绑定了一个 Key）：

```text
DeepSeek API用量：

账号：主号
  余额 ¥67.67（赠金 ¥7.77 / 充值 ¥59.90） · 累计花费 ¥12.33 · 累计 Token 2,148,838
  今日花费 ¥0.340 · 今日 Token 13,579 · Key 2 个 · 已绑定 1 个

API-1：sk-abcde**1234
  名称：示例
  余额 ¥67.67（赠金 ¥7.77 / 充值 ¥59.90）
  累计花费 ¥12.33 · Token 2,148,838
    输入 2,034,324（命中 1,919,810 / 未命中 114,514）
    输出 114,514 · 请求 233 次 · 命中率 94.37%
  今日花费 ¥0.340 · Token 13,579
    输入 12,345（命中 10,000 / 未命中 2,345）
    输出 1,234 · 请求 12 次 · 命中率 81.00%
  统计起始日期：2026-10-22

更新于：2026-10-27 09:29
```

一个 Key 都没绑定时，只输出「账号」那一段（余额 / 累计 / 今日 / Key 个数），并提示怎么绑定。

---

## 功能

- `dsu`：列出自己所有账号的总用量；有绑定 Key 时同时列出每个 Key 的明细
- **账号优先**：只要 `dsu.token` 设置过账号，不绑定 Key 也能查余额和账号总用量
- 一个用户可以绑定多个账号，每个账号下可以绑定多个 Key；别人的账号 Token 也可以帮你绑
- 支持只发 Key 尾号绑定（`dsu.add <Key尾号>`），不需要在聊天里发完整 Key
- `dsu.token`：读取 / 设置账号 Token，保存到数据库；不填 token 时读取 bot 所在电脑的浏览器
- **群聊可用**：QQ 官方机器人不开放私聊时，在群里也能直接 `dsu.token` / `dsu.add`
- 群聊里发过账号 Token 或完整 Key 的消息会**自动撤回**（可配置），失败时提示手动撤回
- `dsu.all [页码]`（管理员）：跨所有账号汇总，分页显示；`dsu.key <名字>` 跨所有账号查单个 Key
- 支持 `adapter-qq`（`qq` / `qqguild`）与 `adapter-onebot`，渲染层可扩展
- 平台 Token / 绑定关系存在 Koishi 数据库里，不写 JSON 文件，不显示原文

## 快速开始

三步，全部可以在群里完成：

```text
dsu.token <备注名>                        # ① 读取 bot 所在电脑的浏览器登录态，保存为「主号」这样的备注
dsu.token <userToken> <备注名>            # ① 或者直接粘贴账号 Token（朋友不在同一台电脑时用这个）
dsu.add <Key尾号> <备注名>                 # ② 绑定一个 Key（可选，不绑也能看账号总用量）
dsu                                       # ③ 查看账号总用量 + 已绑定 Key 的明细
```

`<Key尾号>` 是平台上 Key 的后四位，例如 Key 是 `sk-xxxxxxabcd` 就发 `abcd`；也可以直接发完整的 `sk-...`。

> 新账号必须带备注名，避免出现一堆分不清的「账号1、账号2」。旧数据会自动补成「账号N」，可以用 `dsu.account rename` 改。

### 多账号

```text
dsu.token <备注名>                             # 默认账号
dsu.add <Key尾号> <另一个userToken> <备注名>    # 把 Key 绑到另一个账号
dsu.add <Key尾号> <备注名>                      # 备注名能对上已有账号时，绑到那个账号
dsu                                            # 所有账号的总用量 + Key 明细
dsu <备注名>                                    # 只看一个账号
dsu <序号/名字>                                 # 只看一个 Key
dsu.account list                               # 查看账号备注
dsu.account rename <账号/备注> <新备注>          # 改账号备注
```

同一个账号下的多个 Key 共用余额；不同账号的余额分开显示。

> 第二个参数如果长得像账号 Token（32 位以上的长串），会被当成 userToken；否则当成备注名。

## 指令

| 指令 | 说明 | 权限 |
| --- | --- | --- |
| `dsu` | 列出所有账号的总用量，以及已绑定 Key 的完整明细 | 所有人 |
| `dsu <备注名>` | 只看某个账号 | 所有人 |
| `dsu <序号/名字>` | 只看某个 Key | 所有人 |
| `dsu.token <备注名>` | 从 bot 本机浏览器读取账号 Token 并保存 | 所有人 |
| `dsu.token <userToken> <备注名>` | 直接粘贴账号 Token | 所有人 |
| `dsu.add <Key尾号> [<备注名>]` | 用 Key 尾号绑定到默认账号（新账号必须带备注名） | 所有人 |
| `dsu.add <Key尾号> <userToken> <备注名>` | 绑定到另一个账号 | 所有人 |
| `dsu.add sk-... [<userToken>] [<备注名>]` | 用完整 Key 绑定（会调用官方接口校验一次） | 所有人 |
| `dsu add ...` / `dsu token ...` | 空格写法，等同 `dsu.add` / `dsu.token` | 所有人 |
| `dsu.account list` | 查看账号备注和 Key 数量 | 所有人 |
| `dsu.account rename <账号/备注> <新备注>` | 修改账号备注 | 所有人 |
| `dsu.remove <序号/名字>` | 移除某个 Key（不影响账号） | 所有人 |
| `dsu.list` | 列出自己绑定的 Key | 所有人 |
| `dsu.unbind` | 解绑全部 Key 和账号 | 所有人 |
| `dsu.all [页码]` | 跨所有账号汇总全部 Key，分页显示 | 管理员 |
| `dsu.key <名字>` | 跨所有账号查指定 Key | 管理员 |
| `dsu.refresh` | 清空查询缓存 | 管理员 |
| `dsu.whoami` | 查看自己的平台 ID、权限等级、绑定/账号状态 | 所有人 |

主指令别名默认是 `额度`，可以在配置里改。`dsu.bind` 作为旧指令保留，等同 `dsu.add`。

## 工作原理（先看这段）

DeepSeek 官方 API 只提供[账号级余额接口](https://api-docs.deepseek.com/zh-cn/api/get-user-balance/)，**没有按 Key 的用量接口**。本插件使用的是 DeepSeek 开放平台网页端自己的一套接口：

| 接口 | 用途 |
| --- | --- |
| `GET /api/v0/users/get_api_keys` | Key 列表（`tracking_id`、名称、脱敏 Key） |
| `GET /api/v0/users/get_user_summary` | 余额、累计花费 |
| `GET /api/v0/usage/by_api_key/amount` | 按 Key × 模型 × 天的 Token（缓存命中 / 未命中 / 输出 / 请求数） |
| `GET /api/v0/usage/by_api_key/cost` | 按 Key × 天的真实扣费 |

认证方式是 `Authorization: Bearer <userToken>`，`userToken` 就是登录平台后存在浏览器 `localStorage` 里的登录态。

这意味着：

- ✅ 不需要改 `base_url`、不需要走代理，用的还是原来的 Key
- ✅ 账号总用量来自账号级接口，不依赖 Key 绑定
- ⚠️ 这不是官方承诺的公开 API，平台改版时插件可能需要跟着改（接口层集中在 `src/api/client.ts`）
- ⚠️ `userToken` 会过期，过期后重新 `dsu.token <备注名>` 即可（插件会提示「平台 Token 失效」）

> 平台对单次查询有 **31 天** 的上限，且 `end` 必须是开区间；插件会自动按 31 天分段查询再合并，所以「累计」是完整的。
>
> 余额是**账号级**的：同一个 userToken 下的 Key 共用一个余额，不同账号的余额分开显示；花费和 Token 按 Key 分开统计。

## 安装

> 多账号版需要 Koishi 的 **database** 服务。Koishi Desktop 默认带 SQLite；如果使用纯 Koishi 项目，请先安装 `@koishijs/plugin-database-sqlite` 或其他数据库插件。

```bash
npm install koishi-plugin-deepseek-keyusage
```

然后在 `koishi.yml` 里启用（或直接在控制台「插件配置」里添加）：

```yaml
plugins:
  deepseek-keyusage:
    autoReadToken: true
```

## 账号 Token

推荐直接用聊天指令（群聊、私聊都可以）：

```text
dsu.token <备注名>                # 读取 bot 所在电脑的 Edge/Chrome，并加备注
dsu.token <userToken> <备注名>     # 或者直接粘贴 token 和备注
```

Token 会保存到这个用户的默认账号，之后 `dsu.add <Key尾号>` 就用它。绑定关系和多账号 Token 都存在 Koishi 数据库里，不会写回 `koishi.yml`，也不会在聊天里显示原文。

如果你更习惯控制台，也可以打开 Koishi 控制台 → 插件配置 → `deepseek-keyusage`，点「平台 Token」下面的：

> 从本机一键读取Token

点一下会扫描本机 Edge / Chrome、验证、填入插件配置并写回 `koishi.yml`，同时写入 `.env` 和剪贴板。

**手动获取**：登录 [platform.deepseek.com](https://platform.deepseek.com) → `F12` → `Application` → `Local Storage` → `https://platform.deepseek.com` → 复制 `userToken` 的值。

> `dsu.token` 的浏览器读取只能读 **bot 跑的那台电脑**。朋友在自己的电脑上，让他自己复制 userToken，然后用 `dsu.token <userToken> <备注名>` 或 `dsu.add <Key尾号> <userToken> <备注名>` 绑定。
>
> `userToken` 等同于账号登录态。不要发到公开渠道，也不要提交到公开仓库。

**默认 Token**：每个用户在数据库里保存的默认账号。插件配置里的 `userToken` 只用于旧数据迁移和控制台一键读取，不会自动给所有用户使用。

## 配置

所有配置都在 Koishi 控制台 → 插件配置 → `deepseek-keyusage` 里，带中文说明。

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `userToken` | 空 | 旧版全局 Token，仅用于迁移；新绑定请用 `dsu.token` |
| `autoReadToken` | `true` | 没有 Token 时自动从本机 Edge / Chrome 读取（只查找 `platform.deepseek.com`，校验通过才会使用） |
| `apiBaseUrl` | `https://platform.deepseek.com` | 平台接口地址 |
| `officialBaseUrl` | `https://api.deepseek.com` | 官方接口，用于校验完整 Key；只发尾号时不需要 |
| `timeZone` | `Asia/Shanghai` | 决定「今日」的边界 |
| `currency` | `CNY` | 展示币种，可选 `USD` |
| `cacheTtl` | `60` | 结果缓存秒数，减少平台请求 |
| `cooldown` | `10` | 同一用户查询冷却秒数 |
| `adminAuthority` | `4` | Koishi 权限等级达到该值视为管理员（auth 插件创建的管理员是 5，普通用户通常是 1） |
| `adminUsers` | `[]` | 管理员白名单，如 `qq:OPENID`、`onebot:123456`、`123456` |
| `allowGroupBind` | `true` | 是否允许在群聊里绑定。默认开启（QQ 官方机器人通常没有私聊） |
| `autoRecallInGroup` | `true` | 群聊里发过账号 Token / 完整 Key 后自动撤回那条消息 |
| `showBalance` | `true` | 是否给普通用户看账户余额 |
| `aliases` | `['额度']` | 主指令别名，冲突时删掉即可 |
| `maxKeys` | `30` | 管理员总览最多展示多少个 Key |
| `maxBindings` | `5` | 每个用户最多绑定多少个 Key |
| `allPageSize` | `10` | 管理员 `dsu.all` 每页展示多少个 Key |
| `requestTimeout` | `10000` | 请求超时（毫秒） |
| `debug` | `false` | 输出请求日志 |

### 获取 `userToken`

1. 浏览器登录 [platform.deepseek.com](https://platform.deepseek.com)
2. 按 `F12` → `Application`（应用）→ `Local Storage` → `https://platform.deepseek.com`
3. 找到 `userToken`，复制它的值（带不带外层引号都能识别）
4. 发送 `dsu.token <userToken> <备注名>`，或粘贴到插件配置的「平台 Token」里并保存

> `userToken` 等同于账号登录态。怀疑泄露时去平台「退出所有设备」即可作废。

## 管理员

判定规则（**白名单和权限等级取并集**，满足任意一条就是管理员，任意一条失效另一条仍能兜底）：

1. **权限等级**：`session.user.authority >= adminAuthority`（默认 `4`）。Koishi auth 插件创建的初始管理员是 5，普通用户通常是 1。
2. **白名单**：`adminUsers` 里包含自己的 ID。不知道 ID 就发 `dsu.whoami`。

```text
平台：qq
用户 ID：C1A2B3...
权限等级：0
管理员：是
绑定：2 个 Key · 1 个账号
默认账号：sk-****abcd
```

`dsu.whoami` 里的「权限等级」就是 **Koishi 的 `user.authority`**，不是插件自己发明的等级。QQ 用户如果没有对应的用户记录（没装 auth 或没绑定），它就是 `0`，这种情况下用 `adminUsers` 白名单最直接。

QQ 官方机器人的用户 ID 是 openid，不是 QQ 号，所以直接用 `dsu.whoami` 复制最省事；OneBot 下就是 QQ 号。

## 适配器

- `adapter-qq`：平台名 `qq` / `qqguild`，使用纯文本（QQ 官方 markdown 需要申请模板，默认不走）
- `adapter-onebot`：平台名 `onebot`，纯文本
- 其他平台：自动回退到默认纯文本渲染，可以直接用

要为新平台定制渲染，在插件加载后调用：

```ts
import { registerRenderer } from 'koishi-plugin-deepseek-keyusage'

registerRenderer('telegram', {
  report: (report, options) => '...',
  overview: (overview, options) => '...',
})
```

只传 `report` 或 `overview` 也可以，另一个会继续用默认实现。

## 安全说明

- 添加 Key 只保存 `tracking_id`、名称和脱敏 Key（`sk-xxxxx**abcd`）；可以只发尾号，完整 Key 只用于一次校验（如果发的是完整 Key），随后丢弃
- 添加时会调用一次官方余额接口确认 Key 有效（401 会被拒绝）
- 同一个 Key 不能在同一个账号下重复添加
- 群聊可用；发过账号 Token 或完整 Key 的消息会自动撤回（`autoRecallInGroup`），撤回失败时会提示手动撤回
- 平台的 `userToken` 只存在 Koishi 数据库里；自动读取只针对本机浏览器里的 `platform.deepseek.com`，控制台一键读取会把 Token 保存到 `data/deepseek-keyusage/token`（权限 0600）。请确保数据目录不进公开仓库

## 开发

```bash
npm install
npm test        # 构建 + 103 个单元/集成测试（Koishi mock 适配器）
npm run build   # 输出到 lib/
npm run watch   # 开发时增量编译
```

测试覆盖：

- 时区与「今日」边界
- Key 脱敏匹配（平台星号数量不固定）、金额/百分比格式化
- 平台接口参数、返回解析、错误码映射、31 天分段与开区间结束
- 用量聚合（累计 / 今日 / 按 Key）
- 多账号、多 Key 绑定、旧数据迁移
- 账号总用量（没有绑定 Key 时也能查）
- 群聊绑定（`dsu.token` / `dsu.add` 都不要求私聊）
- 浏览器 Token 提取、Token 解析顺序、`.env` 写入
- 完整指令流程（添加多个 → 列表 → 按序号/名字查询 → 移除 → 解绑）

目录：

```text
src/
  index.ts        插件入口、Token 一键读取动作
  config.ts       配置 Schema（控制台 GUI）
  permissions.ts  管理员判定（白名单 + Koishi 权限并集）
  commands.ts     指令层
  account-service.ts  账号 / 绑定 / 聚合（多账号版主逻辑）
  api/client.ts   平台接口
  api/official.ts 官方接口（Key 校验）
  store.ts        旧版绑定关系迁移
  token.ts        Token 自动读取（Edge/Chrome LevelDB）与 .env 写入
  clipboard.ts    复制到系统剪贴板
  render.ts       多适配器渲染
  aggregate.ts    用量聚合
  utils/          时间、格式化
tests/            单元测试 + 集成测试
```

> 自动读取使用内置的纯 JS LevelDB 读取器，不依赖原生模块；读取失败仍可手动填 Token。

## 常见问题

**没有绑定 Key，能查吗**：能。`dsu` 先看账号；只要 `dsu.token` 设置过账号，就会显示余额、累计花费、今日花费和 Key 个数。绑定 Key 只是多看每个 Key 的明细。

**提示「平台 Token 失效」**：重新 `dsu.token <备注名>` 读取，或 `dsu.token <userToken> <备注名>` 粘贴新 Token；平台改过密码 / 退出过设备后旧 Token 会失效。

**一键读取提示「没有找到可用的 Token」**：
1. 确认浏览器和 Koishi 在同一台电脑；
2. 用 Edge 或 Chrome 登录并刷新一次 platform.deepseek.com；
3. 看 Koishi 日志里有没有 `读取浏览器 LevelDB 失败`（通常是浏览器正在写入，重试一次即可）；
4. 仍然不行就发 `dsu.token <userToken> <备注名>`。

**为什么余额是账号级的**：余额属于整个账号，花费和 Token 能按 Key 分开。

**累计从什么时候开始**：从平台记录的 Key 创建时间开始算；Key 创建之前的花费不会算进这个 Key。账号级的「累计花费」来自平台账号汇总，不受影响。

**为什么 `dsu.all` 里有的 Key 显示 0**：平台只返回有调用记录的 Key 数据；没被调用过的 Key 就是 0。

**接口不是官方的，会不会挂**：会。平台改版时需要更新 `src/api/client.ts`，其余逻辑不受影响。

## License

MIT
