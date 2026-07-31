# 眼科客户管理系统

连锁眼镜/眼科门店客户管理系统。两店共用一套系统、同一个后台，门店身份靠设备绑定区分，会员数据全连锁共享。前台离线可用，联网自动同步。

## 架构

```
                      ┌─────────────────────────────────────┐
                      │  云端服务器（Node + Express + SQLite）│
                      │  - 权威数据源 server.db             │
                      │  - 后台管理 SPA（Vite/React）       │
                      │  - 同步合并 / 营业额 / 绩效 / 审计  │
                      └───────────────▲─────────────────────┘
                                      │ HTTP（push/pull）
              ┌───────────────────────┴───────────────────────┐
              │                                               │
   ┌──────────▼─────────┐                       ┌────────────▼──────────┐
   │  前台设备 A（门店1）│                       │  前台设备 B（门店2）  │
   │  Electron + SQLite  │                       │  Electron + SQLite    │
   │  client.db 全量缓存 │                       │  client.db 全量缓存  │
   │  断网可完整操作     │                       │  断网可完整操作      │
   └─────────────────────┘                       └───────────────────────┘
```

**核心设计**：

- 客户（`customer_id` 永久主键）与会员（扩展身份）分离建模，改号不丢历史记录
- 余额/豆/累计积分只能通过 Ledger 流水 `+/-` 增减，不存可被覆盖的"当前值"
- 多设备断网各自操作，联网后按流水 ID 去重追加，合并出负余额/豆自动入异常待复核
- 门店是设备标签（部署时绑定一次），不是权限层级，所有数据互通
- 任意门店都能查可用任意会员的余额/豆/积分

## 目录结构

```
packages/
├── shared/                  # 共享业务逻辑（被 server 和 client 共用）
│   ├── prisma/schema.prisma  # 唯一数据模型
│   ├── generated/client/     # Prisma 生成的 client
│   └── src/                  # 支付/账本/档位/豆 FIFO/营业额/绩效/同步
├── server/                  # 云端服务器
│   ├── src/                  # Express API + 同步 + 审计
│   ├── web/                 # 后台管理 SPA 源码
│   └── server.db            # 云端权威数据库（运行时生成）
└── client/                  # 前台 Electron 客户端
    ├── electron/            # 主进程：IPC、本地 DB、同步循环
    └── src/                 # Renderer：登记/支付/查询页面
```

## 环境要求

- Node.js ≥ 18（推荐 20+）
- npm ≥ 9（使用 workspace）
- 打包 Electron 客户端需要对应平台工具链（Windows / macOS / Linux 任一）

## 一、首次部署

### 1. 克隆并安装

```bash
git clone <repo-url> clinic-management
cd clinic-management
npm install                 # 安装所有 workspace 依赖
npm run shared:generate     # 生成 Prisma Client（必须执行一次）
```

### 2. 初始化云端数据库

```bash
npm -w @clinic/server run db:push
```

该命令会用 `packages/shared/prisma/schema.prisma` 在 `packages/server/server.db` 建表，**首次启动时还会自动加载种子数据**（示例门店、店员、档位、模板、品牌），后续都可在后台界面增删改。

### 3. 启动云端服务器

**开发模式**（热重载）：

```bash
npm run server:dev          # http://localhost:4000
```

**生产模式**：

```bash
npm -w @clinic/server run build   # 编译 TS + 构建后台 SPA
npm -w @clinic/server run start    # node dist/index.js
```

后台管理界面：浏览器打开 `http://<服务器IP>:4000/`，输入密码 `safe@safe` 登录。

### 4.（可选）配置服务器端口与密码

在 `packages/server/` 下创建 `.env`（参考 `.gitignore` 已忽略）：

```env
PORT=4000
CLINIC_BACKEND_PASSWORD=safe@safe       # 后台登录密码
CLINIC_CHANGE_PASSWORD=change123        # 修改历史/敏感信息二次密码
CLINIC_TOKEN_SECRET=<随机字符串>         # 会话 token 签名（生产必改）
DATABASE_URL=file:./server.db           # 不填则默认 packages/server/server.db
```

部署到公网时建议反向代理 + HTTPS，并修改所有默认密码。

## 二、前台设备部署

每家门店一台前台设备（PC），有两种使用方式。

### 方式 A：完整 Electron 客户端（推荐生产用）

**开发调试**（需要桌面环境）：

```bash
npm -w @clinic/client run dev:vite   # 终端 1：启动 renderer 5174
npm -w @clinic/client run dev:electron  # 终端 2：等待 5174 后启动 Electron
```

或一条命令同时启动：

```bash
npm -w @clinic/client run dev
```

**打包成安装包**：

```bash
npm -w @clinic/client run build    # 编译主进程 TS + 构建 renderer 静态资源
# 再用 electron-builder 按目标平台打包（需自行配置 build 脚本）
```

### 方式 B：浏览器预览（仅供快速体验，无离线能力）

```bash
npm -w @clinic/client run dev:vite   # http://localhost:5174
```

浏览器模式下 `window.clinic` 不存在，前端会自动 fallback 到 HTTP 调用云端，**没有本地数据库和离线能力**，仅用于流程演示。

### 首次启动前台设备的初始化流程

1. 启动客户端，进入设备绑定页
2. 填写：服务器地址（如 `http://192.168.1.10:4000`）、门店名（如「明亮眼科总店」）、设备码
3. 输入后台密码 `safe@safe` 确认绑定
4. 绑定信息保存在 `<userData>/device.json`，之后这台设备产生的所有记录自动带门店标记
5. 客户端会拉取全连锁会员数据到本地 `client.db`，完成后即可使用

> 修改门店绑定需进后台「设备管理」用后台密码操作，前台不允许直接改。

### 配置服务器地址

Electron 客户端默认连 `http://localhost:4000`。三种方式覆盖：

- 设备绑定页填写（推荐，写入 `<userData>/server.json` 持久化）
- 启动前设置环境变量 `CLINIC_SERVER_URL=http://<服务器IP>:4000`
- 仅本机调试可不配置

## 三、日常使用

### 前台（店员）

主流程：**会员登记 / 检查登记 → 支付**。

- 会员登记：填姓名/手机号/卡号/生日，自动查重复用 `customer_id`，可填初始余额/豆
- 检查登记：选配镜部或眼科部模板 → 填内容 → 设复查 → 跳支付
- 支付页：折扣手输、余额/豆抵扣（100豆=1元，整百使用）、实付改写需备注、他人卡代付、断网常驻提示
- 查询：会员查询 / 检查查询，列表支持筛选，详情页显示跨门店全部历史

### 后台（老板）

浏览器打开 `http://<服务器IP>:4000/`，密码 `safe@safe`：

- **配置**：门店、设备、店员、品牌、检查模板、会员档位、豆有效期（全部界面增删改）
- **营业额统计**：按月/门店/部门拆分，含储值池结转滚入公式，柱状图
- **店员绩效**：跨店合并算阶梯提成（2万内 4% / 超 2万 7%）、开卡数、品牌激励
- **异常待复核**：断网合并后余额/豆为负的会员，附冲突流水明细，人工电话核实后走 Ledger 增量调整
- **回收站**：删除记录保留 30 天，标注来源门店
- **审计日志 / 数据导出**：按月/按天查询全部修改与删除记录，支持按门店筛选导出

### 全局提醒

所有页面顶部红点：当天生日会员数 + 待/逾期复查数，点击跳对应列表。

## 四、密码与安全

| 用途 | 默认密码 | 说明 |
|------|----------|------|
| 后台登录 | `safe@safe` | 老板控制，仅告诉信任的店员 |
| 修改历史/敏感信息 | `change123` | 改手机号、改历史记录时二次确认 |
| 设备绑定 | `safe@safe` | 部署新设备时验证 |

- 余额/豆/积分的修改**不需要密码**，但强制走 Ledger 增量记录 + 必填备注，云端永久留存
- 所有密码均不在前端明文展示
- 生产部署务必修改 `.env` 中的默认值并启用 HTTPS

## 五、离线与同步

- 前台设备启动时拉取全连锁会员数据到本地，断网期间登记/查询/支付/修改都能本地完整执行
- 新记录用 UUID 生成 ID，避免多设备冲突
- 设备顶部常驻离线图标 + "数据更新于 X 分钟前"
- 联网恢复后自动 push 本地变更、pull 服务器变更，目标延迟 ≤ 1 分钟
- 余额/豆/积分变动优先级最高
- 断网期间多端并发消费导致合并后余额/豆为负 → 自动进入后台「异常待复核」列表，**不静默、不拦截**，等人工核实后走 Ledger 调整

支付页使用余额/豆抵扣时，离线状态下有**常驻醒目提示**：建议避免使用余额/豆，或先电话向另一家店核实。

## 六、数据备份

- 云端 `packages/server/server.db` 是权威数据源，建议每日定时备份
- 备份命令示例：

  ```bash
  cp packages/server/server.db backups/server-$(date +%Y%m%d).db
  ```

- 后台「数据导出」可按门店筛选导出 Excel/数据库格式
- 审计日志记录所有增删改，可按月/按天查询

## 七、常用命令速查

| 命令 | 说明 |
|------|------|
| `npm install && npm run shared:generate` | 首次安装 + 生成 Prisma Client |
| `npm -w @clinic/server run db:push` | 初始化/同步 server.db 表结构 |
| `npm run server:dev` | 启动云端服务器（开发，热重载）|
| `npm -w @clinic/server run build` | 编译服务器 + 后台 SPA |
| `npm -w @clinic/server run start` | 生产启动服务器 |
| `npm -w @clinic/client run dev` | 启动 Electron 客户端（开发）|
| `npm -w @clinic/client run dev:vite` | 仅启动前台 renderer（浏览器预览，无离线）|
| `npm -w @clinic/client run build` | 编译 Electron 主进程 + renderer |
| `npm run dev` | 同时启动 shared:generate + server + client |

## 八、技术栈

- **数据库**：SQLite + Prisma ORM（单 schema，云端与客户端共用）
- **云端**：Node.js + Express + 静态后台 SPA
- **前台**：Electron + 本地 SQLite + Vite + React + TypeScript
- **后台**：Vite + React + TailwindCSS + Recharts 图表
- **共享**：`@clinic/shared` 包统一封装支付、账本、档位、豆 FIFO、营业额、绩效、同步逻辑

## 已交付范围

- Phase 1（核心可用）：客户/会员模型、门店设备标签、会员/检查登记、支付、Ledger 记账、查询
- Phase 2（离线与多店）：本地全量缓存、断网操作、联网同步合并、异常待复核、门店筛选

后续 Phase 3（后台运营深化）与 Phase 4（体验打磨）按需求文档继续迭代。
