# koishi-plugin-deepseek-keyusage

在 QQ 里查 DeepSeek API Key 的用量：**余额、累计花费、今日花费、Token 明细（缓存命中 / 未命中 / 输出）、缓存命中率**。

一个账号下可以有多个 API Key：每个 Key 可以单独添加、单独查看余额和用量。

示例输出：

**DeepSeek API用量**

- **API-1**：`sk-abcde**1234`
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

- `dsu`：查自己的余额、累计/今日花费、Token 明细和缓存命中率
- 一个用户可以绑定多个 Key：`dsu.add sk-...`，`dsu` 会一次列出所有 Key 的完整用量
- `dsu.all`（管理员）：所有 Key 的今日/累计花费、Token、命中率，以及账户总花费
- `dsu.key <名字>`（管理员）：按名字 / Key ID / 脱敏后缀查任意一个 Key
- 支持 `adapter-qq`（`qq` / `qqguild`）与 `adapter-onebot`，渲染层可扩展
- 平台 Token 在 Koishi 控制台的插件配置里填；配置项下面是「从本机一键读取Token」链接，点一下自动读取、填入配置、写入 `.env` 并复制到剪贴板
- 留空时插件会**自动**从本机 Edge / Chrome 读取，不需要手动复制

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
> 余额是**账号级**的，所以所有人看到的是同一个余额；花费和 Token 是按 Key 分开的。

## 安装

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

插件需要 DeepSeek 开放平台的登录态，二选一：

**方式 A：一键读取（推荐）**

打开 Koishi 控制台 → 插件配置 → `deepseek-keyusage`，点「平台 Token」下面的：

> 从本机一键读取Token

点一下会依次完成：

1. 扫描本机 Edge / Chrome 的 Local Storage，只找 `platform.deepseek.com` 的 `userToken`；
2. 用平台接口验证有效性；
3. 填入插件配置并写回 `koishi.yml`；
4. 写入项目根目录的 `.env`（`DEEPSEEK_PLATFORM_TOKEN`）；
5. 复制到系统剪贴板；
6. 跳回配置页，没有额外的页面。

Token 输入框保持留空也能正常用（会读取缓存文件）。

**方式 B：手动复制**

登录 [platform.deepseek.com](https://platform.deepseek.com) → `F12` → `Application` → `Local Storage` → `https://platform.deepseek.com` → 复制 `userToken` 的值，粘贴到插件配置里。

> 自动读取的前提：浏览器和 Koishi 在同一台电脑上，且已经登录过平台。读取范围仅限浏览器 Local Storage 文件，不会上传任何数据；Token 只保存在本机 `data/deepseek-keyusage/` 下。
>
> `userToken` 等同于账号登录态。不要发到公开渠道，也不要提交到公开仓库。

**Token 的解析顺序**：配置项 → 环境变量 `DEEPSEEK_PLATFORM_TOKEN` → 本地缓存文件 → 自动扫描浏览器。

## 配置

所有配置都在 Koishi 控制台 → 插件配置 → `deepseek-keyusage` 里，带中文说明。

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `userToken` | 空 | 平台登录态，密码框显示。留空时自动读取 |
| `autoReadToken` | `true` | 自动从本机 Edge / Chrome 读取 Token（只查找 `platform.deepseek.com`，不校验通过不会使用） |
| `apiBaseUrl` | `https://platform.deepseek.com` | 平台接口地址 |
| `officialBaseUrl` | `https://api.deepseek.com` | 官方接口，用于绑定校验 Key |
| `timeZone` | `Asia/Shanghai` | 决定「今日」的边界 |
| `currency` | `CNY` | 展示币种，可选 `USD` |
| `cacheTtl` | `60` | 结果缓存秒数，减少平台请求 |
| `cooldown` | `10` | 同一用户查询冷却秒数 |
| `adminAuthority` | `4` | Koishi 权限等级达到该值视为管理员（auth 插件创建的管理员是 5，普通用户通常是 1） |
| `adminUsers` | `[]` | 管理员白名单，如 `qq:OPENID`、`onebot:123456`、`123456` |
| `allowGroupBind` | `true` | 是否允许在群里添加 Key；建议关掉，只允许私聊 |
| `showBalance` | `true` | 是否给普通用户看账户余额 |
| `aliases` | `['额度']` | 主指令别名，冲突时删掉即可 |
| `maxKeys` | `30` | `dsu.all` 最多展示多少个 Key |
| `maxBindings` | `5` | 每个用户最多绑定多少个 Key |
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
| `dsu` | 列出自己绑定的所有 Key 的完整用量 | 已添加用户 |
| `dsu <序号/名字>` | 只看指定的那个 Key | 已添加用户 |
| `dsu.add sk-xxx` | 添加一个 Key（建议私聊；可加多个） | 所有人 |
| `dsu.remove <序号/名字>` | 移除某个 Key | 所有人 |
| `dsu.list` | 列出自己绑定的 Key | 所有人 |
| `dsu.unbind` | 解绑全部 Key | 所有人 |
| `dsu.all` | 所有 Key + 账户总览 | 管理员 |
| `dsu.key <名字>` | 查指定 Key | 管理员 |
| `dsu.refresh` | 清空缓存 | 管理员 |
| `dsu.whoami` | 查看自己的平台 ID、Koishi 权限等级、绑定状态 | 所有人 |

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

- 添加 Key 只保存 `tracking_id`、名称和脱敏 Key（`sk-xxxxx**abcd`），完整 Key 只用于一次校验，随后丢弃
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

> 自动读取依赖 `classic-level`（LevelDB 读取器，安装依赖时会一起装上）。如果安装环境拿不到原生模块，插件会退回字符串扫描，仍可手动填 Token。

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
