#!/usr/bin/env bash
# =============================================================================
# One-click deploy for the eye-clinic management system on Oracle Cloud A1
# (ARM64 / aarch64 / Ampere) — also works on x86_64.
#
# What it does (idempotent — safe to re-run):
#   1. Checks architecture (warns if not aarch64, but continues)
#   2. Installs Node.js 20 LTS (ARM64 or x86_64 build) if missing
#   3. Installs npm deps + generates Prisma client
#   4. On FIRST run: interactively asks for the two initial passwords and a
#      token secret, writes them to packages/server/.env (bcrypt-hashed in the
#      DB after first boot; .env is never needed again after that)
#   5. Creates the SQLite database (server.db) in ./data/ and applies the schema
#   6. Builds the server (TypeScript + admin SPA)
#   7. Installs a systemd service (auto-start on boot + crash restart)
#   8. Optionally configures Nginx reverse proxy + Let's Encrypt HTTPS
#
# Usage:
#   git clone <repo-url> clinic-management && cd clinic-management
#   bash deploy/deploy.sh
#
# Re-run after `git pull` to rebuild + restart (skips the password prompt if
# .env already exists).
# =============================================================================
set -euo pipefail

# ---- pretty output ----------------------------------------------------------
C_R='\033[0;31m'; C_G='\033[0;32m'; C_Y='\033[1;33m'; C_B='\033[0;34m'; C_0='\033[0m'
log()  { echo -e "${C_B}▶${C_0} $*"; }
ok()   { echo -e "${C_G}✓${C_0} $*"; }
warn() { echo -e "${C_Y}!${C_0} $*"; }
die()  { echo -e "${C_R}✗${C_0} $*" >&2; exit 1; }

# ---- preflight --------------------------------------------------------------
[[ $EUID -eq 0 ]] || die "请用 root 或 sudo 运行：sudo bash deploy/deploy.sh"

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"
DATA_DIR="$REPO_DIR/data"
ENV_FILE="$REPO_DIR/packages/server/.env"
SERVICE_NAME="clinic"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
NODE_MAJOR=20

log "部署目录: $REPO_DIR"
log "数据目录: $DATA_DIR"

ARCH="$(uname -m)"
case "$ARCH" in
  aarch64|arm64) ARCH_NORM="arm64"; ok "架构: aarch64 (Oracle A1 Ampere) ✓" ;;
  x86_64|amd64)  ARCH_NORM="amd64"; warn "架构: x86_64（非 A1 ARM。脚本同样可用，但你之前要求在 ARM64 上验证。）" ;;
  *) die "不支持的架构: $ARCH" ;;
esac

# ---- 1. Node.js -------------------------------------------------------------
install_node_deb() {
  log "通过 NodeSource 安装 Node.js ${NODE_MAJOR} LTS (${ARCH_NORM})…"
  # NodeSource setup script auto-detects arm64 vs amd64 and configures apt.
  if ! command -v curl >/dev/null; then apt-get update -y && apt-get install -y curl ca-certificates gnupg; fi
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y nodejs
}

if command -v node >/dev/null 2>&1; then
  NODE_VER="$(node -v | sed 's/v//; s/\..*//')"
  if [[ "$NODE_VER" -ge "$NODE_MAJOR" ]]; then
    ok "Node.js 已安装: $(node -v)"
  else
    warn "Node.js 版本过低 ($(node -v))，升级到 ${NODE_MAJOR}…"
    install_node_deb
  fi
else
  install_node_deb
  ok "Node.js 已安装: $(node -v)"
fi
command -v npm >/dev/null 2>&1 || die "npm 未找到，安装异常"

# ---- 2. deps + prisma generate ----------------------------------------------
log "安装依赖（首次较慢，主要是 Electron 二进制；服务端部署用不到 Electron，但 workspace 会一并装）…"
# Use a domestic mirror if the default is slow — auto-detected by timing.
# Set CLINIC_NPM_MIRROR=1 to force, or CLINIC_NPM_MIRROR=0 to skip.
if [[ "${CLINIC_NPM_MIRROR:-auto}" == "1" ]]; then
  npm config set registry https://registry.npmmirror.com
fi
npm install
npm run shared:generate   # prisma generate — downloads the arm64 query engine on A1
# shared:build 是必需步骤：server 运行时通过 node_modules/@clinic/shared 软链
# 解析到 packages/shared/dist/src/index.js（package.json main）。只 generate
# 不 build 会导致 dist 不存在，server 启动报 ERR_MODULE_NOT_FOUND 崩溃。
npm run shared:build
ok "依赖安装完成"

# ---- 3. .env (first run only) ----------------------------------------------
write_env() {
  log "首次部署：需要设置初始密码（之后可在后台界面修改，无需再碰 .env）"
  local backend_pw change_pw token_secret
  while true; do
    read -r -p "  后台登录密码（至少 6 位）: " backend_pw
    [[ ${#backend_pw} -ge 6 ]] && break
    warn "密码至少 6 位，请重新输入"
  done
  while true; do
    read -r -p "  敏感信息修改密码（至少 6 位）: " change_pw
    [[ ${#change_pw} -ge 6 ]] && break
    warn "密码至少 6 位，请重新输入"
  done
  token_secret="$(node -e "console.log(require('crypto').randomUUID())")"
  mkdir -p "$DATA_DIR"
  cat > "$ENV_FILE" <<EOF
# 生成于 $(date). 首次启动后密码进入数据库（bcrypt 哈希），改密码走后台界面，无需再改本文件。
PORT=4000
DATABASE_URL=file:${DATA_DIR}/server.db
CLINIC_BACKEND_PASSWORD=${backend_pw}
CLINIC_CHANGE_PASSWORD=${change_pw}
CLINIC_TOKEN_SECRET=${token_secret}
EOF
  chmod 600 "$ENV_FILE"
  ok ".env 已写入 $ENV_FILE（权限 600）"
  echo -e "${C_Y}请妥善保管这两个密码。后台登录密码也是新设备绑定密码。${C_0}"
}

if [[ -f "$ENV_FILE" ]]; then
  ok ".env 已存在，跳过密码输入（如需重置密码请进后台界面，或删除此文件后重跑）"
  # Make sure DATA_DIR exists even on re-run.
  mkdir -p "$DATA_DIR"
else
  write_env
fi

# ---- 4. database ------------------------------------------------------------
log "创建/更新数据库结构（SQLite）…"
# Run prisma directly with the env's DATABASE_URL so the db lands in DATA_DIR
# (the workspace npm script hardcodes a different relative path).
set +u
export $(grep -v '^#' "$ENV_FILE" | xargs)
set -u
npx prisma db push --schema=packages/shared/prisma/schema.prisma --accept-data-loss
ok "数据库就绪: $DATA_DIR/server.db"

# ---- 5. build ---------------------------------------------------------------
log "编译服务器（TypeScript + 后台 SPA）…"
npm -w @clinic/server run build
ok "服务器编译完成"

# ---- 6. systemd -------------------------------------------------------------
log "配置 systemd 服务（开机自启 + 崩溃自动重启）…"
# Run as the user that owns the repo (so file perms stay consistent). If run
# via sudo, SUDO_USER is the real user; otherwise root.
RUN_USER="${SUDO_USER:-$(stat -c '%U' "$REPO_DIR")}"
RUN_USER="${RUN_USER:-root}"
NODE_BIN="$(command -v node)"
cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=Eye-Clinic Management Server
After=network.target

[Service]
Type=simple
User=${RUN_USER}
WorkingDirectory=${REPO_DIR}
EnvironmentFile=${ENV_FILE}
ExecStart=${NODE_BIN} ${REPO_DIR}/packages/server/dist/server/src/index.js
Restart=always
RestartSec=5
# Graceful shutdown
KillSignal=SIGTERM
TimeoutStopSec=15

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable "$SERVICE_NAME" >/dev/null 2>&1
systemctl restart "$SERVICE_NAME"
ok "服务已启动: systemctl status $SERVICE_NAME"

# ---- 7. (optional) Nginx + HTTPS -------------------------------------------
setup_nginx() {
  log "配置 Nginx 反向代理…"
  apt-get install -y nginx >/dev/null
  read -r -p "  你的域名（例如 clinic.example.com，留空则只用 IP+HTTP）: " DOMAIN
  if [[ -z "$DOMAIN" ]]; then
    warn "未提供域名，配置为纯 HTTP（仅适合内网测试）。生产建议有域名 + HTTPS。"
    cat > /etc/nginx/sites-available/clinic <<'EOF'
server {
    listen 80;
    server_name _;
    client_max_body_size 25m;
    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
EOF
  else
    cat > /etc/nginx/sites-available/clinic <<EOF
server {
    listen 80;
    server_name ${DOMAIN};
    client_max_body_size 25m;
    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF
  fi
  ln -sf /etc/nginx/sites-available/clinic /etc/nginx/sites-enabled/clinic
  rm -f /etc/nginx/sites-enabled/default
  nginx -t && systemctl reload nginx || die "Nginx 配置有误"
  ok "Nginx 已配置 (HTTP)"

  if [[ -n "$DOMAIN" ]]; then
    log "申请 Let's Encrypt HTTPS 证书（需要域名已解析到本机）…"
    apt-get install -y certbot python3-certbot-nginx >/dev/null
    if certbot --nginx -n --redirect -d "$DOMAIN" --agree-tos -m "admin@${DOMAIN}"; then
      ok "HTTPS 已启用: https://${DOMAIN}"
    else
      warn "证书申请失败。请确认域名已解析到本机公网 IP，然后手动运行：certbot --nginx -d ${DOMAIN}"
    fi
  fi
}

read -r -p "是否配置 Nginx 反向代理 + HTTPS？[y/N] " DO_NGINX
if [[ "${DO_NGINX:-N}" =~ ^[Yy]$ ]]; then
  setup_nginx
else
  warn "跳过 Nginx。直接访问 http://<服务器IP>:4000/（明文 HTTP，注意余额/支付等敏感数据）。"
fi

# ---- done -------------------------------------------------------------------
echo
ok "部署完成！"
echo -e "  后台管理:  ${C_G}http://<服务器IP>:4000/${C_0}  （或配置的域名）"
echo -e "  首次登录用 .env 里设置的后台密码"
echo
echo -e "  常用命令:"
echo -e "    systemctl status $SERVICE_NAME      # 查看运行状态"
echo -e "    journalctl -u $SERVICE_NAME -f      # 实时日志"
echo -e "    sudo bash deploy/deploy.sh          # 更新代码后重新构建+重启"
echo
warn "ARM64 验证提醒：请在 A1 实例上确认 `node -e \"console.log(process.arch)\"` 输出 arm64，"
warn "并完成 README 中的双设备断网同步测试后再正式营业。"
