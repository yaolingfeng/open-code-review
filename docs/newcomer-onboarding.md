# Open Code Review 新人本地开发手册

本文档面向第一次接触 `open-code-review` 仓库的新同事，目标是帮你尽快完成四件事：

- 搭好本地开发环境
- 从源码启动 CLI 和 Dashboard
- 跑通基础测试和自检
- 理解安装、升级与常见排障方式

本文内容基于 2026-05-14 对当前仓库的实际命令验证整理，已验证通过的本地环境版本为：

- `node v24.14.0`
- `pnpm 9.15.0`

项目在代码层要求的最低版本是：

- `Node.js >= 20.0.0`
- `pnpm@9.15.0`

## 1. 先理解仓库结构

`open-code-review` 是一个 `pnpm + Nx` 的 monorepo，核心目录如下：

| 路径 | 作用 | 你什么时候会用到 |
| --- | --- | --- |
| `packages/cli` | OCR 的 CLI 主程序，提供 `ocr init`、`ocr dashboard`、`ocr doctor`、`ocr update` 等命令 | 改 CLI 行为、安装流程、状态管理时 |
| `packages/dashboard` | Dashboard 源码，前端是 React，后端是 Express + Socket.IO | 改 Web 界面、命令中心、会话浏览能力时 |
| `packages/agents` | OCR 的技能、命令模版、reviewer persona 资产 | 改 reviewer、技能提示词、命令模版时 |
| `packages/shared/platform` | 跨平台工具函数 | CLI / Dashboard 共用能力时 |
| `packages/shared/graph` | Code graph 相关共享逻辑 | 改图谱能力时 |
| `packages/*-e2e` | 端到端测试项目 | 做回归验证或补充 e2e 时 |
| `openspec/` | 项目规范与变更提案 | 做较大功能改动前后时 |
| `.ocr/` | 当前仓库自身的 OCR 配置与运行数据目录 | 跑 dashboard、本地 review、调试状态时 |

## 2. 环境准备

开始前请确认机器上至少具备以下工具：

- `node`
- `pnpm`
- `git`

可选但推荐安装：

- `gh`
  用于把 review 结果发布到 GitHub PR
- `Claude Code` 或 `OpenCode`
  用于打开 Dashboard 的命令执行、Ask the Team 等 AI 相关能力

先做一次基础检查：

```bash
node -v
pnpm -v
git --version
```

如果你要体验完整的 GitHub 发布能力，再补一条：

```bash
gh --version
```

## 3. 第一天建议走通的最短路径

如果你的目标是“先把仓库跑起来，再开始看代码”，建议严格按下面顺序执行。

### 3.1 拉代码并安装依赖

```bash
git clone https://github.com/spencermarx/open-code-review.git
cd open-code-review
pnpm install
```

### 3.2 构建本地 CLI

```bash
pnpm build:cli
```

这个命令不是只构建 CLI。当前仓库里它会先构建 `dashboard`，再打包 `packages/cli`，并把 dashboard 产物复制到 CLI 的 `dist` 目录里。因此：

- 只改了 `packages/cli`，通常也可以直接跑这个命令
- 改了 `packages/dashboard` 且希望验证最终打包结果时，也应该跑这个命令

### 3.3 跑一次开发态自检

```bash
pnpm nx run cli:doctor
```

如果看到类似下面的结果，通常说明仓库本身已经具备本地开发条件：

- `git` 被识别
- `.ocr/skills/` 存在
- `Dashboard viewer` 可用
- `Dashboard commands` 可用

以下情况是常见的，不一定代表有问题：

- `gh` 未安装：只会影响“发布到 GitHub PR”
- `.ocr/data/ocr.db` 不存在：通常会在第一次 review 或 dashboard 启动后生成
- `.ocr/sessions/` 不存在：通常会在真正跑 review / map 之后出现

### 3.4 启动 Dashboard 源码开发模式

```bash
pnpm nx run dashboard:dev
```

当前仓库已自带 `.ocr/` 目录，所以在仓库根目录直接启动通常没问题。成功启动后，一般会看到两类地址：

- 后端服务地址，例如 `http://localhost:4173`
- Vite 前端地址，例如 `http://localhost:5173/`

这意味着：

- Dashboard 后端已经起来了
- Vite 前端已经把 API 代理到后端
- 你可以直接在浏览器打开 `http://localhost:5173/`

退出方式：

```bash
Ctrl+C
```

## 4. 从源码启动的推荐方式

这部分是“仓库开发者视角”，不是“普通 OCR 用户视角”。

### 4.1 CLI 源码启动

最直接的源码入口是：

```bash
pnpm exec tsx packages/cli/src/index.ts <subcommand>
```

例如：

```bash
pnpm exec tsx packages/cli/src/index.ts doctor
pnpm exec tsx packages/cli/src/index.ts update --dry-run
```

仓库里也提供了 Nx 包装命令，日常更方便：

```bash
pnpm nx run cli:doctor
pnpm nx run cli:init
pnpm nx run cli:update
pnpm nx run cli:progress
```

注意两点：

- CLI 永远以“当前工作目录”作为目标项目目录
- `ocr init` 会把 `.ocr/`、命令模版和配置写到你当前所在目录，不要在错误目录下执行

### 4.2 Dashboard 源码启动

推荐命令：

```bash
pnpm nx run dashboard:dev
```

它的真实行为是：

1. 启动 `packages/dashboard/src/server/index.ts`
2. 等待后端把端口写入 `.ocr/data/server-port`
3. 再启动 Vite，并把前端代理到正确的后端端口

因此即使 `4173` 被占用，后端自动切到别的端口后，前端代理也能跟上，不需要你手工改一堆配置。

前提条件只有一个：当前目录或父目录里必须能找到 `.ocr/`。如果没有，启动会直接失败，并提示你先运行 `ocr init`。

### 4.3 发布态验证

如果你想验证“打包后的 CLI 是否可执行”，可以在构建后直接运行：

```bash
node packages/cli/dist/index.js doctor
```

这更接近 npm 发布后的实际运行方式。

## 5. 常用测试命令

推荐把测试分成“最小验证”和“完整验证”两层。

### 5.1 最小验证

你第一次改代码，优先跑这些：

```bash
pnpm build:cli
pnpm test:cli
pnpm nx run dashboard:test
```

这组命令覆盖了：

- CLI 打包链路
- CLI 单元测试
- Dashboard 单元测试

### 5.2 完整验证

如果改动范围更大，再补下面这些：

```bash
pnpm test
pnpm e2e
```

如果只想跑某一类 e2e，可以按需使用：

```bash
pnpm e2e:cli
pnpm e2e:dashboard-api
pnpm e2e:dashboard-ui
```

### 5.3 命令对照表

| 目标 | 命令 | 说明 |
| --- | --- | --- |
| 构建整个开发链路的核心产物 | `pnpm build:cli` | 会先构建 dashboard，再打包 CLI |
| 跑 CLI 单测 | `pnpm test:cli` | 新人第一次改 CLI 时最值得先跑 |
| 跑 Dashboard 单测 | `pnpm nx run dashboard:test` | 改 UI、路由、服务端接口时优先跑 |
| 跑全部单测 | `pnpm test` | 回归范围更大时使用 |
| 跑全部 e2e | `pnpm e2e` | 耗时更高，适合作为提交前补充验证 |

## 6. OCR 的安装、初始化与升级

这一节分两个视角说明：普通使用者和本仓库开发者。

### 6.1 普通使用者如何安装 OCR

如果你不是在改 `open-code-review` 本身，而是想在另一个业务仓库里使用 OCR，最短路径是：

```bash
npm install -g @open-code-review/cli
cd your-project
ocr init
ocr doctor
ocr dashboard
```

说明：

- `ocr init` 会自动检测本机安装的 AI 工具，并写入对应命令模版
- `ocr doctor` 用来确认依赖是否齐全
- `ocr dashboard` 会启动本地 Dashboard

### 6.2 升级到最新版本

升级 CLI 包之后，不要只停留在 `npm install`。还需要同步本地 `.ocr` 资产：

```bash
npm i -g @open-code-review/cli@latest
ocr update
```

如果你只想先看会改什么：

```bash
ocr update --dry-run
```

常用升级选项：

```bash
ocr update --commands
ocr update --skills
ocr update --inject
```

升级时默认会保留这些内容：

- `.ocr/config.yaml`
- `.ocr/skills/references/reviewers/`
- `.ocr/sessions/`

也就是说，常规升级不会覆盖你的项目配置、reviewer persona 和历史 review 数据。

### 6.3 本仓库开发者如何验证升级逻辑

如果你在改 `packages/cli` 的安装或升级逻辑，推荐先做一次 dry-run：

```bash
pnpm exec tsx packages/cli/src/index.ts update --dry-run
```

如果 `doctor` 提示“本地 `.ocr` 版本落后于当前 CLI 版本”，优先执行：

```bash
ocr update
```

而不是手工删目录重装。

## 7. 常见问题与排障

### 7.1 `pnpm nx run dashboard:dev` 启动失败，提示找不到 `.ocr/`

原因通常是你当前目录不是一个已初始化的 OCR 工作目录。

处理方式：

```bash
ocr init
```

如果你是在本仓库里开发，请确认命令是在仓库根目录执行，而不是在 `packages/dashboard` 之外的其他目录执行。

### 7.2 `ocr doctor` 里 `gh` 缺失

这不是核心功能故障，只会影响把 review 发布到 GitHub PR。

安装并登录：

```bash
gh auth login
```

### 7.3 `ocr doctor` 提示 `.ocr/data/ocr.db` 不存在

这是常见现象，通常不需要处理。数据库会在第一次实际运行 review，或者第一次启动 dashboard 时自动生成。

### 7.4 命令输出很多 `NO_COLOR` / `FORCE_COLOR` 警告

在当前环境里，这类 Node 警告不会阻止命令执行。只要最终命令返回成功，就不属于阻塞问题。

### 7.5 我改了 Dashboard，为什么还要跑 `pnpm build:cli`

因为当前 CLI 的发布产物会把 dashboard 的构建结果一起带上。只跑 `packages/dashboard` 本地开发模式，不等于验证了最终 CLI 打包产物。

## 8. 新人第一天建议清单

- [ ] 在仓库根目录执行 `pnpm install`
- [ ] 执行 `pnpm build:cli`
- [ ] 执行 `pnpm nx run cli:doctor`
- [ ] 执行 `pnpm test:cli`
- [ ] 执行 `pnpm nx run dashboard:test`
- [ ] 执行 `pnpm nx run dashboard:dev` 并确认浏览器可打开
- [ ] 如果要体验完整 GitHub 发布流程，补装并登录 `gh`
- [ ] 如果要在其他业务仓库里试用 OCR，去目标仓库执行 `ocr init`

## 9. 推荐阅读顺序

如果你准备继续深入代码，建议按下面顺序看仓库文档：

1. `README.md`
2. `CONTRIBUTING.md`
3. `packages/dashboard/README.md`
4. `packages/cli/README.md`
5. `packages/dashboard/src/server/ARCHITECTURE.md`

这样能先建立整体认知，再进入具体实现细节。
