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

后台管理界面：浏览器打开 `http://<服务器IP>:4000/`，输入后台密码登录（密码在首次启动时由 `.env` 的初始密码写入数据库，之后在后台界面修改）。

### 4.（可选）配置服务器端口与初始密码

在 `packages/server/` 下创建 `.env`（参考 `.gitignore` 已忽略）：

```env
PORT=4000
CLINIC_BACKEND_PASSWORD=<你的初始后台密码>   # 仅首次启动用一次，之后走后台界面修改
CLINIC_CHANGE_PASSWORD=<你的初始敏感信息密码>  # 仅首次启动用一次，之后走后台界面修改
CLINIC_TOKEN_SECRET=<随机字符串>               # 会话 token 签名（生产必改）
DATABASE_URL=file:./server.db                 # 不填则默认 packages/server/server.db
```

> 注意：两个初始密码必须在 `.env` 里配置，否则首次启动会报错退出（不允许用写死的默认值）。首次启动后密码进入数据库（bcrypt 哈希），改密码走后台「修改密码」页面，无需再碰 `.env`。详见第四节。

部署到公网时建议反向代理 + HTTPS（部署脚本可一键配置，见第九节）。

## 二、前台设备部署

每家门店一台前台设备（PC），有两种使用方式。

> **关于 `npm install` 较慢**：首次安装主要耗时在下载 Electron 二进制（大几十到上百 MB），加上四个 workspace 分别装依赖，属于正常范围。如果长时间卡住，可配置国内镜像源：
> ```bash
> npm config set registry https://registry.npmmirror.com
> # Electron 二进制镜像（如单独卡在 electron 下载）：
> export ELECTRON_MIRROR=https://registry.npmmirror.com/-/binary/electron/
> ```

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

**打包成 Windows 安装包（exe）**：

> 必须在 **Windows 机器**上打包（Prisma 的查询引擎是平台相关的二进制，跨平台打包会带错引擎导致运行崩溃）。Windows 上无需额外工具链——本项目没有 node-gyp 原生模块。

```bash
npm install && npm run shared:generate   # 装依赖 + 生成对应平台的 Prisma 引擎
npm -w @clinic/client run dist           # 编译 + electron-builder 打 NSIS 安装包
```

产物路径：

```
packages/client/dist-installer/眼科客户管理系统 Setup 1.0.0.exe
```

- 双击 exe 即可安装，安装向导可选目录、自动创建桌面快捷方式和开始菜单。
- 装完点开就能用，店员不需要碰命令行、不需要知道 npm。
- 卸载走 Windows 标准方式（「设置 → 应用」或右键卸载），见第十节。
- 未做代码签名，首次启动 Windows SmartScreen 可能提示"已保护你的电脑"，点「更多信息 → 仍要运行」即可。如需消除提示，需自行购买代码签名证书并在 `electron-builder.yml` 配置。

### 方式 B：浏览器预览（仅供快速体验，无离线能力）

```bash
npm -w @clinic/client run dev:vite   # http://localhost:5174
```

浏览器模式下 `window.clinic` 不存在，前端会自动 fallback 到 HTTP 调用云端，**没有本地数据库和离线能力**，仅用于流程演示。

### 首次启动前台设备的初始化流程

1. 启动客户端，进入设备绑定页
2. 填写：服务器地址（如 `http://192.168.1.10:4000`）、门店名（如「明亮眼科总店」）、设备码
3. 输入后台密码确认绑定
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

后台有两种打开方式，**背后是同一套页面和逻辑，不是两份代码**：

1. **前台 Electron 客户端内**：导航栏有「后台管理」入口，点进去要求输入后台密码（每次重新进入都要验证，避免无人值守时被随意查看营业额等敏感数据），验证后内嵌显示后台界面。
2. **浏览器远程访问**：手机、家里电脑打开 `http://<服务器IP>:4000/`，输入后台密码登录（界面已做响应式，手机上也能正常浏览）。

后台功能：

- **配置**：门店、设备、店员、品牌、检查模板、会员档位、豆有效期（全部界面增删改）
- **营业额统计**：按月/门店/部门拆分，含储值池结转滚入公式，柱状图
- **店员绩效**：跨店合并算阶梯提成（2万内 4% / 超 2万 7%）、开卡数、品牌激励
- **异常待复核**：断网合并后余额/豆为负的会员，附冲突流水明细，人工电话核实后走 Ledger 增量调整
- **回收站**：删除记录保留 30 天，标注来源门店
- **审计日志 / 数据导出**：按月/按天查询全部修改与删除记录，支持按门店筛选导出
- **修改密码**：后台登录密码、敏感信息修改密码分开改，改时要求先验证当前密码

### 全局提醒

所有页面顶部红点：当天生日会员数 + 待/逾期复查数，点击跳对应列表。

## 四、密码与安全

系统有两道密码，**全部从数据库读取（bcrypt 哈希存储），不在代码里硬编码、不在前端明文展示**：

| 用途 | 说明 |
|------|------|
| 后台登录 / 设备绑定 | 进入后台管理、绑定新设备时验证。老板控制，仅告诉信任的店员 |
| 修改历史/敏感信息 | 改手机号、改历史记录等敏感操作时二次确认 |

**密码生命周期（重要）**：

- `.env` 里的 `CLINIC_BACKEND_PASSWORD` / `CLINIC_CHANGE_PASSWORD` **只在首次启动时当"初始密码"用一次**，写入数据库后就跟 `.env` 没关系了。
- 之后改密码走**后台「修改密码」页面**（无需碰 `.env`、无需重启服务）：先输入当前密码验证通过，再输入新密码。两类密码分开改。
- 改了后台登录密码后，**当前所有登录状态立即失效**，需用新密码重新登录；新设备绑定也跟着新密码走。
- 如果 `.env` 两个初始密码都没配，且数据库里也没有记录，服务**首次启动直接报错退出**，不允许用写死的默认值悄悄跑起来。
- 忘记密码的恢复方式：在服务器上用以下命令直接重置数据库中的密码哈希（无需知道旧密码，无需重启服务）：

  ```bash
  cd <项目根目录>
  node --input-type=module -e "
  import bcrypt from 'bcryptjs';
  import { PrismaClient } from '@clinic/shared';
  const prisma = new PrismaClient();
  const newPassword = '你的新密码';  // ← 改成你要的新密码
  const hash = await bcrypt.hash(newPassword, 10);
  // 重置后台密码（BACKEND）。要重置敏感信息密码，把 'BACKEND' 改成 'CHANGE'
  await prisma.password.upsert({
    where: { key: 'BACKEND' },
    update: { hash },
    create: { key: 'BACKEND', hash }
  });
  console.log('密码已重置');
  await prisma.\$disconnect();
  "
  ```

  > 重置 BACKEND 密码后，之前所有后台登录状态会立即失效，需用新密码重新登录。已绑定的前台设备不受影响（设备绑定是一次性的）。

其他安全规则：

- 余额/豆/积分的修改**不需要密码**，但强制走 Ledger 增量记录 + 必填备注，云端永久留存
- 支付的操作人自动等于检查登记的"登记人"，全程只认一个人（充值除外，充值仍需单独选操作店员）
- 生产部署务必启用 HTTPS（见部署脚本的可选 Nginx + Let's Encrypt）

## 五、离线与同步

- 前台设备启动时拉取全连锁会员数据到本地，断网期间登记/查询/支付/修改都能本地完整执行
- 新记录用 UUID 生成 ID，避免多设备冲突
- 设备顶部常驻离线图标 + "数据更新于 X 分钟前"；"N待传"数字悬停可见提示"本机还有 N 条记录尚未同步到云端服务器"
- 联网恢复后自动 push 本地变更、pull 服务器变更，目标延迟 ≤ 1 分钟
- 余额/豆/积分变动优先级最高
- 断网期间多端并发消费导致合并后余额/豆为负 → 自动进入后台「异常待复核」列表，**不静默、不拦截**，等人工核实后走 Ledger 调整

支付页使用余额/豆抵扣时，离线状态下有**常驻醒目提示**：建议避免使用余额/豆，或先电话向另一家店核实。

> **双设备断网同步测试（部署后必做）**：两台电脑都装好、都跑起来后，按以下流程走一遍真实测试，确认断网同步与异常复核正常：
> 1. 两台设备都联网，各拉取一次全量数据
> 2. 断开设备 A 的网络，在 A 上对同一会员做一笔余额消费
> 3. 在设备 B（仍联网）上对同一会员做另一笔余额消费
> 4. 恢复 A 的网络，等待自动同步（≤1 分钟）
> 5. 检查后台「异常待复核」列表是否出现该会员，附带的冲突流水明细是否正确
> 6. 确认联网状态下"N待传"几十秒内归零

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
| `npm -w @clinic/client run dist` | 打包 Windows NSIS 安装包（需在 Windows 上运行）|
| `npm run dev` | 同时启动 shared:generate + server + client |

## 八、技术栈

- **数据库**：SQLite + Prisma ORM（单 schema，云端与客户端共用）
- **云端**：Node.js + Express + 静态后台 SPA
- **前台**：Electron + 本地 SQLite + Vite + React + TypeScript
- **后台**：Vite + React + TailwindCSS + Recharts 图表
- **共享**：`@clinic/shared` 包统一封装支付、账本、档位、豆 FIFO、营业额、绩效、同步逻辑

## 九、云端一键部署（Oracle A1 / ARM64）

仓库自带部署脚本 `deploy/deploy.sh`，目标是在 Oracle Cloud A1（ARM64/Ampere）实例上一条命令跑完。同样适用于 x86_64 服务器。

```bash
git clone <repo-url> clinic-management && cd clinic-management
sudo bash deploy/deploy.sh
```

脚本会自动完成：

1. 检测架构（aarch64 / x86_64），安装对应平台的 Node.js 20 LTS
2. 安装依赖 + 生成 Prisma 客户端（ARM64 上自动下载 arm64 查询引擎）
3. 首次运行时**交互式**让你输入两个初始密码（后台登录、敏感信息修改），写入 `packages/server/.env`（权限 600）
4. 在 `data/` 目录创建 SQLite 数据库并建表
5. 编译服务器（TypeScript + 后台 SPA）
6. 配置 systemd 服务（开机自启 + 崩溃自动重启），立即启动
7. 可选：配置 Nginx 反向代理 + Let's Encrypt HTTPS（需要你提供域名，且域名已解析到本机公网 IP）

**更新代码后重新部署**：`git pull && sudo bash deploy/deploy.sh`（已存在 `.env` 时跳过密码输入，仅重新构建+重启）。

**常用运维命令**：

```bash
systemctl status clinic          # 查看运行状态
journalctl -u clinic -f          # 实时日志
```

> **ARM64 验证说明**：脚本已针对 ARM64 编写（NodeSource 自动选 arm64 包、Prisma 自动下载 arm64 引擎）。由于开发环境是 x86_64，脚本逻辑在此验证通过；请在 A1 实例上实跑一次确认，跑完后执行 `node -e "console.log(process.arch)"` 应输出 `arm64`，并完成第五节的双设备断网同步测试。

> **关于 Prisma 在 ARM64**：本项目用 Prisma 5.x 的 library 引擎，`prisma generate` 会自动检测平台并下载 `linux-arm64` 的查询引擎二进制，无需手动配置 `binaryTargets`。

## 十、卸载

### Windows 前台客户端

就是普通 Windows 软件，用系统标准方式卸载即可：

- 「设置 → 应用 → 已安装的应用」找到「眼科客户管理系统」点卸载，或
- 在安装目录找到卸载程序运行

卸载默认**保留**本地数据（`client.db`、`device.json` 在 `%APPDATA%/眼科客户管理系统/` 下），方便重装后继续用。想彻底清空：卸载后手动删除 `%APPDATA%/眼科客户管理系统/` 整个目录。

### 云端服务（Linux 服务器）

```bash
sudo systemctl stop clinic && sudo systemctl disable clinic
sudo rm /etc/systemd/system/clinic.service && sudo systemctl daemon-reload
# （如装了 Nginx）sudo rm /etc/nginx/sites-enabled/clinic && sudo systemctl reload nginx
# 如装了 certbot 证书：sudo certbot delete --clinic
```

### 数据库与备份文件位置

| 内容 | 路径 |
|------|------|
| 云端权威数据库 | `<repo>/data/server.db`（部署脚本）或 `packages/server/server.db`（手动部署）|
| 前台本地数据库 | Windows: `%APPDATA%/眼科客户管理系统/` 下的 `client.db` |
| 设备绑定信息 | Windows: `%APPDATA%/眼科客户管理系统/device.json` |
| 服务器配置/初始密码 | `packages/server/.env`（首次启动后改密码无需再动）|
| 备份 | 自行指定的目录，如 `backups/server-YYYYMMDD.db` |

想清空重来：删除上述数据库文件后重新 `db:push` + 启动即可（会重新走首次部署的密码初始化流程）。

## 已交付范围

- Phase 1（核心可用）：客户/会员模型、门店设备标签、会员/检查登记、支付、Ledger 记账、查询
- Phase 2（离线与多店）：本地全量缓存、断网操作、联网同步合并、异常待复核、门店筛选
- Phase 3（后台运营）：后台并入前台（密码门禁+浏览器远程共用一套代码）、营业额结转公式、店员跨店绩效阶梯、豆有效期、检查模板编辑器、回收站、操作日志、数据导出、密码后台可改、一键部署、Windows exe 安装包

后续 Phase 4（体验打磨）按需求文档继续迭代。
