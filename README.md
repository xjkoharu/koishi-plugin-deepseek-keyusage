# koishi-plugin-deepseek-keyusage

在 QQ 里查 DeepSeek API Key 的用量：**余额、累计花费、今日花费、Token 明细（缓存命中 / 未命中 / 输出）、缓存命中率**。

一个账号下可以有多个 API Key：每个 Key 可以单独添加、单独查看余额和用量。

示例输出：

**DeepSeek API用量**

- **API-1**：`sk-abcde**1234`
  - 账号：账号1
  - 名称：示例
  - 余额 ¥67.67（赠金 ¥7.77 / 充值 ¥59.90）
  - 累计花费 ¥12.33 · Token 2,148,838
    - 输入 2,034,324（命中 1,919,810 / 未命中 114,514）
    - 输出 114,514 · 请求 233 次 · 命中率 94.37%
  - 今日花费 ¥0.34 · Token 13,579
    - 输入 12,345（命中 10,000 / 未命中 2,345）
    - 输出 1,234 · 请求 12 次 · 命中率 81.00%
  - 统计起始日期：1145-01-04

更新于：1919-08-10 00:00

---

## 功能

- `dsu`：查自己绑定的所有账号 / Key 的余额、累计/今日花费、Token 明细和缓存命中率
- 一个用户可以绑定多个账号下的多个 Key：每个 `userToken` 是一个账号，账号下可以绑定多个 Key
- 支持只发 Key 尾号绑定（`dsu.add 25f0`），避免在聊天里发完整 Key；也支持 `dsu add 25f0` 空格写法
- `dsu.token`：通过聊天读取/设置账号 Token，保存到数据库；不填 token 时读取 bot 所在电脑的浏览器
- 别人把 userToken 和 Key 给你，你也可以绑；`dsu.add 25f0 对方的userToken` 一条命令完成
- `dsu.all [页码]`（管理员）：跨所有账号汇总，分页显示；`dsu.key <名字>` 跨所有账号查单个 Key
- 支持 `adapter-qq`（`qq` / `qqguild`）与 `adapter-onebot`，渲染层可扩展
- 平台 Token / 绑定关系存在 Koishi 数据库里，不写 JSON 文件，不显示原文

## 多账号怎么用

```text
dsu.token                       # 读取 bot 本机浏览器，保存为当前账号
dsu.token 你的userToken          # 或者直接粘贴另一个账号的 token
dsu.add 25f0                    # 在当前账号里按尾号绑定 Key
dsu.add 25f0 另一个userToken     # 直接绑到另一个账号
dsu                             # 列出所有账号下的 Key
dsu 账号2                       # 只看账号2
dsu.list                        # 只看绑定列表
```

同一个账号下的多个 Key 共用余额；不同账号的余额分开显示。账号编号（账号1、账号2）按绑定顺序自动生成。

> `dsu.token` 的「一键读取」只能读 **bot 跑的那台电脑** 的 Edge/Chrome。朋友在自己的电脑上，需要把 userToken 私聊发给 bot，或者用 `dsu.add 25f0 他的token`。

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
- ⚠️ 这不是官方承诺的公开 API，平台改版时插件可能需要跟着改（接口层集中在 `src/api/client.ts`）
- ⚠️ `userToken` 会过期，过期后重新点一次「从本机一键读取Token」即可（插件会提示「平台 Token 失效」）

> 平台对单次查询有 **31 天** 的上限，且 `end` 必须是开区间；插件会自动按 31 天分段查询再合并，所以「累计」是完整的。
>
> 余额是**账号级**的：同一个 userToken 下的 Key 共用一个余额，不同账号的余额分开显示；花费和 Token 按 Key 分开统计。

## 安装

> 多账号版需要 Koishi 的 **database** 服务。Koishi Desktop 默认带 SQLite；如果使用纯 Koishi 项目，请先安装 `@koishijs/plugin-database-sqlite` 或其他数据库插件。

在 Koishi 项目目录里：

```bash
# 本地目录安装
npm install ../koishi-deepseek-keyusage

# 或者发布到 npm 之后
npm install koishi-plugin-deepseek-keyusage
```

然后在 `koishi.yml` 里启用（或直接在控制台「插件配置」里添加）：

```yaml
plugins:
  deepseek-keyusage:
    autoReadToken: true
```

开发时也可以用 `npm run build` 后把 `lib` 交给 Koishi 加载。

## 平台 Token

多账号版推荐直接用聊天命令：

```text
dsu.token                  # 读取 bot 所在电脑的 Edge/Chrome
dsu.token 你的userToken     # 或者直接粘贴
```

Token 会保存到这个用户的默认账号，之后 `dsu.add 25f0` 就用它。绑定关系和多账号 Token 都存在 Koishi 数据库里，不会写回 `koishi.yml`，也不会在聊天里显示原文。

如果你更习惯控制台，也可以打开 Koishi 控制台 → 插件配置 → `deepseek-keyusage`，点「平台 Token」下面的：

> 从本机一键读取Token

点一下会扫描本机 Edge / Chrome、验证、填入插件配置并写回 `koishi.yml`，同时写入 `.env` 和剪贴板。

**手动获取**：登录 [platform.deepseek.com](https://platform.deepseek.com) → `F12` → `Application` → `Local Storage` → `https://platform.deepseek.com` → 复制 `userToken` 的值。

> `dsu.token` 的浏览器读取只能读 **bot 跑的那台电脑**。朋友在自己的电脑上，需要把 userToken 私聊发给 bot，或者用 `dsu.add 25f0 他的token`。
>
> `userToken` 等同于账号登录态。不要发到公开渠道，也不要提交到公开仓库。

**默认 Token 的解析顺序**：当前用户数据库里保存的默认账号 → 插件配置的 `userToken` → 环境变量 `DEEPSEEK_PLATFORM_TOKEN` → 本地缓存文件。

## 配置

所有配置都在 Koishi 控制台 → 插件配置 → `deepseek-keyusage` 里，带中文说明。

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `userToken` | 空 | 后备的全局平台 Token；聊天里用 `dsu.token` 设置的账号优先 |
| `autoReadToken` | `true` | 没有 Token 时自动从本机 Edge / Chrome 读取（只查找 `platform.deepseek.com`，不校验通过不会使用） |
| `apiBaseUrl` | `https://platform.deepseek.com` | 平台接口地址 |
| `officialBaseUrl` | `https://api.deepseek.com` | 官方接口，用于校验完整 Key；只发尾号时不需要 |
| `timeZone` | `Asia/Shanghai` | 决定「今日」的边界 |
| `currency` | `CNY` | 展示币种，可选 `USD` |
| `cacheTtl` | `60` | 结果缓存秒数，减少平台请求 |
| `cooldown` | `10` | 同一用户查询冷却秒数 |
| `adminAuthority` | `4` | Koishi 权限等级达到该值视为管理员（auth 插件创建的管理员是 5，普通用户通常是 1） |
| `adminUsers` | `[]` | 管理员白名单，如 `qq:OPENID`、`onebot:123456`、`123456` |
| `allowGroupBind` | `true` | 是否允许在群里添加 Key；建议关掉，只允许私聊 |
| `showBalance` | `true` | 是否给普通用户看账户余额 |
| `aliases` | `['额度']` | 主指令别名，冲突时删掉即可 |
| `maxKeys` | `30` | 单次详情最多展示多少个 Key |
| `maxBindings` | `5` | 每个用户最多绑定多少个 Key |
| `allPageSize` | `10` | 管理员 `dsu.all` 每页展示多少个 Key |
| `requestTimeout` | `10000` | 请求超时（毫秒） |
| `debug` | `false` | 输出请求日志 |

### 获取 `userToken`

1. 浏览器登录 [platform.deepseek.com](https://platform.deepseek.com)
2. 按 `F12` → `Application`（应用）→ `Local Storage` → `https://platform.deepseek.com`
3. 找到 `userToken`，复制它的值（带不带外层引号都能识别）
4. 粘贴到插件配置的「平台 Token」里并保存

> `userToken` 等同于账号登录态。只填在自己的服务器上，不要发到公开渠道，也别提交到公开仓库。怀疑泄露时去平台「退出所有设备」即可作废。

## 指令

| 指令 | 说明 | 权限 |
| --- | --- | --- |
| `dsu` | 列出自己绑定的所有账号 / Key 的完整用量 | 已绑定用户 |
| `dsu 账号1` | 只看某个账号下的 Key | 已绑定用户 |
| `dsu <序号/名字>` | 只看指定的那个 Key | 已绑定用户 |
| `dsu.token [userToken]` | 设置当前账号；不填 token 时读取 bot 本机浏览器 | 所有人 |
| `dsu.add <Key尾号> [userToken]` | 用 Key 尾号绑定；不填 token 时用当前账号 | 所有人 |
| `dsu.add sk-xxx [userToken]` | 用完整 Key 绑定 | 所有人 |
| `dsu add <Key尾号>` | 空格写法，等同 `dsu.add <Key尾号>` | 所有人 |
| `dsu.remove <序号/名字>` | 移除某个 Key | 所有人 |
| `dsu.list` | 列出自己绑定的 Key | 所有人 |
| `dsu.unbind` | 解绑全部 Key 和默认账号 | 所有人 |
| `dsu.all [页码]` | 跨所有账号汇总全部 Key，分页显示 | 管理员 |
| `dsu.key <名字>` | 跨所有账号查指定 Key | 管理员 |
| `dsu.refresh` | 清空缓存 | 管理员 |
| `dsu.whoami` | 查看自己的平台 ID、权限等级、绑定/默认账号状态 | 所有人 |

主指令别名默认是 `额度`，可以在配置里改。`dsu.bind` 作为旧指令保留，等同 `dsu.add`。

## 管理员

判定规则（**白名单和权限等级取并集**，满足任意一条就是管理员，任意一条失效另一条仍能兜底）：

1. **权限等级**：`session.user.authority >= adminAuthority`（默认 `4`）。Koishi auth 插件创建的初始管理员是 5，普通用户通常是 1。
2. **白名单**：`adminUsers` 里包含自己的 ID。不知道 ID 就发 `dsu.whoami`。

```
平台：qq
用户 ID：C1A2B3...
权限等级：0
管理员：是
绑定：2 个（示例A、示例B）
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

- 添加 Key 只保存 `tracking_id`、名称和脱敏 Key（`sk-xxxxx**abcd`）；可以只发尾号（如 `25f0`），完整 Key 只用于一次校验（如果发的是完整 Key），随后丢弃
- 添加时会调用一次官方余额接口确认 Key 有效（401 会被拒绝）
- 同一个 Key 不能被重复添加，避免重复占用
- 建议 `allowGroupBind: false`，只允许私聊添加；群里添加后提醒撤回消息
- 平台 Token 优先从 Koishi 配置读取；自动读取只针对本机浏览器里的 `platform.deepseek.com`，Token 会保存到 `data/deepseek-keyusage/token`（权限 0600）。请确保数据目录不进公开仓库

## 开发

```bash
npm install
npm test        # 构建 + 81 个单元/集成测试（Koishi mock 适配器）
npm run build   # 输出到 lib/
npm run watch   # 开发时增量编译
```

测试覆盖：

- 时区与「今日」边界
- Key 脱敏匹配（平台星号数量不固定）、金额/百分比格式化
- 平台接口参数、返回解析、错误码映射、31 天分段与开区间结束
- 用量聚合（累计 / 今日 / 按 Key）
- 多 Key 绑定、旧数据迁移、跨用户占用拦截
- 浏览器 Token 提取、Token 解析顺序、`.env` 写入
- 完整指令流程（添加多个 → 列表 → 按序号/名字查询 → 移除 → 解绑）

目录：

```
src/
  index.ts        插件入口、Token 一键读取动作
  config.ts       配置 Schema（控制台 GUI）
  permissions.ts  管理员判定（白名单 + Koishi 权限并集）
  commands.ts     指令层
  service.ts      绑定、查询、聚合
  api/client.ts   平台接口
  api/official.ts 官方接口（Key 校验）
  store.ts        绑定关系持久化（支持一人多 Key）
  token.ts        Token 自动读取（Edge/Chrome LevelDB）与 .env 写入
  clipboard.ts    复制到系统剪贴板
  render.ts       多适配器渲染
  aggregate.ts    用量聚合
  utils/          时间、格式化
tests/            单元测试 + 集成测试
```

> 自动读取使用内置的纯 JS LevelDB 读取器，不依赖原生模块；读取失败仍可手动填 Token。

## 常见问题

**提示「平台 Token 失效」**：在插件配置里重新点一次「从本机一键读取Token」，或者手动复制 `userToken` 保存；如果平台改过密码/退出过设备，旧 Token 会失效。

**一键读取提示「没有找到可用的 Token」**：
1. 确认浏览器和 Koishi 在同一台电脑；
2. 用 Edge 或 Chrome 登录并刷新一次 platform.deepseek.com；
3. 看 Koishi 日志里有没有 `读取浏览器 LevelDB 失败`（通常是浏览器正在写入，重试一次即可）；
4. 仍然不行就手动复制 `userToken`。

**为什么余额是账号级的**：余额属于整个账号，花费和 Token 能按 Key 分开。

**累计从什么时候开始**：从平台记录的 Key 创建时间开始算；Key 创建之前的花费不会算进这个 Key。

**为什么 `dsu.all` 里有的 Key 显示 0**：平台只返回有调用记录的 Key 数据；没被调用过的 Key 就是 0。

**接口不是官方的，会不会挂**：会。平台改版时需要更新 `src/api/client.ts`，其余逻辑不受影响。

## License

MIT
