#!/usr/bin/env bash
# =============================================================================
# One-click deploy for the eye-clinic management system on Oracle Cloud A1
# (ARM64 / aarch64 / Ampere) — also works on x86_64.
#
# Designed for the user's actual A1 environment:
#   - Node installed via nvm (do NOT apt-install another node — would conflict)
#   - nginx already installed + enabled (config empty, script fills it in)
#   - certbot already installed, certificate for <domain> already present
#     (script REUSES the existing cert instead of re-applying)
#
# Run as a NORMAL user (the one with nvm). The script uses `sudo` internally
# only for the steps that need root (systemd unit, nginx config). This keeps
# node/npm running under your nvm-managed PATH (sudo would lose nvm's PATH).
#
# Idempotent — safe to re-run after `git pull` to rebuild + restart.
#
# Usage:
#   git clone -b trae/agent-BlHKA9 <repo-url> clinic-management && cd clinic-management
#   bash deploy/deploy.sh
# =============================================================================
set -euo pipefail

# ---- pretty output ----------------------------------------------------------
C_R='\033[0;31m'; C_G='\033[0;32m'; C_Y='\033[1;33m'; C_B='\033[0;34m'; C_0='\033[0m'
log()  { echo -e "${C_B}▶${C_0} $*"; }
ok()   { echo -e "${C_G}✓${C_0} $*"; }
warn() { echo -e "${C_Y}!${C_0} $*"; }
die()  { echo -e "${C_R}✗${C_0} $*" >&2; exit 1; }

# ---- preflight: run as normal user (nvm lives in user home) -----------------
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"
DATA_DIR="$REPO_DIR/data"
ENV_FILE="$REPO_DIR/packages/server/.env"
SERVICE_NAME="clinic"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
NODE_MAJOR=20

log "部署目录: $REPO_DIR"
log "数据目录: $DATA_DIR"

# sudo wrapper — used only for systemd/nginx writes. Pre-validate so a missing
# password prompt doesn't interrupt mid-script.
if [[ $EUID -eq 0 ]]; then
  warn "以 root 运行（不推荐，会丢失 nvm PATH）。建议用普通用户跑本脚本。"
  SUDO=""
else
  sudo -v >/dev/null 2>&1 || die "需要 sudo 权限来配置 systemd/nginx。请确认当前用户在 sudoers。"
  SUDO="sudo"
fi

ARCH="$(uname -m)"
case "$ARCH" in
  aarch64|arm64) ARCH_NORM="arm64"; ok "架构: aarch64 (Oracle A1 Ampere) ✓" ;;
  x86_64|amd64)  ARCH_NORM="amd64"; warn "架构: x86_64（非 A1 ARM。脚本同样可用。）" ;;
  *) die "不支持的架构: $ARCH" ;;
esac

# ---- 1. Node.js (use whatever the current PATH provides — typically nvm) ----
# Do NOT apt-install node: the user has nvm-managed node; apt node would shadow
# it and break nvm. Just verify version.
command -v node >/dev/null 2>&1 || die "未找到 node。请用 nvm 装好 Node ${NODE_MAJOR}+ 后重跑：nvm install ${NODE_MAJOR} && nvm use ${NODE_MAJOR}"
NODE_VER="$(node -v | sed 's/v//; s/\..*//')"
[[ "$NODE_VER" -ge "$NODE_MAJOR" ]] || die "Node 版本过低 ($(node -v))，请 nvm install ${NODE_MAJOR} 后重跑"
command -v npm >/dev/null 2>&1 || die "npm 未找到"
ok "Node: $(node -v)  npm: $(npm -v)  架构: $(node -p 'process.arch')"
[[ "$(node -p 'process.arch')" == "arm64" ]] && ok "node 是 arm64 构建 ✓" || warn "node 不是 arm64 构建 ($(node -p 'process.arch'))，Prisma 会下载错误引擎，请检查 nvm 装的是否 arm64 版"

# ---- 2. deps + prisma generate (the ARM64 engine download step) -------------
log "安装依赖（首次较慢，主要是 Electron 二进制；服务端用不到 Electron 但 workspace 会一并装）…"
# Optional domestic mirror for faster Electron/prisma binary download.
if [[ "${CLINIC_NPM_MIRROR:-0}" == "1" ]]; then
  npm config set registry https://registry.npmmirror.com
  export ELECTRON_MIRROR=https://registry.npmmirror.com/-/binary/electron/
  export PRISMA_ENGINES_MIRROR=https://registry.npmmirror.com/-/binary/prisma
fi
npm install
log "生成 Prisma 客户端（下载 arm64 查询引擎，这是 ARM 部署最关键的一步）…"
npm run shared:generate
log "编译 @clinic/shared（server 的 tsc 依赖它的 dist 类型声明，必须先 build）…"
npm -w @clinic/shared run build
ok "依赖 + Prisma 客户端 + shared 包就绪"

# Verify the ARM64 engine actually landed on disk.
ENGINE_FILE="$(find node_modules packages/*/node_modules -name 'libquery_engine-linux-arm64-*.node' -type f 2>/dev/null | head -1 || true)"
if [[ -n "$ENGINE_FILE" ]]; then
  ok "Prisma ARM64 引擎已下载: $ENGINE_FILE"
  # Confirm it's really aarch64 ELF. Prefer `file`, fallback to `readelf -h`,
  # neither installed → just warn (don't fail — the filename already indicates arm64).
  if command -v file >/dev/null 2>&1; then
    file "$ENGINE_FILE" | sed 's/^/    /'
  elif command -v readelf >/dev/null 2>&1; then
    readelf -h "$ENGINE_FILE" | grep -E 'Machine|Class' | sed 's/^/    /'
  else
    warn "未安装 file/readelf，跳过 ELF 架构二次校验（文件名已含 linux-arm64，可接受）"
  fi
else
  die "未找到 arm64 引擎文件！prisma generate 可能下载失败。请检查网络/镜像，或手动运行: BINARY_TARGET=linux-arm64 npx prisma generate --schema=packages/shared/prisma/schema.prisma"
fi

# ---- 3. .env (first run only) ----------------------------------------------
write_env() {
  log "首次部署：设置初始密码（之后可在后台界面修改，无需再碰 .env）"
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
  ok ".env 已存在，跳过密码输入"
  mkdir -p "$DATA_DIR"
else
  write_env
fi

# ---- 4. database ------------------------------------------------------------
log "创建/更新数据库结构（SQLite）…"
# Use the env's DATABASE_URL (absolute path) so the db lands in DATA_DIR.
set +u
export $(grep -v '^#' "$ENV_FILE" | xargs)
set -u
npx prisma db push --schema=packages/shared/prisma/schema.prisma --accept-data-loss
ok "数据库就绪: $DATA_DIR/server.db"

# ---- 5. build ---------------------------------------------------------------
log "编译服务器（TypeScript + 后台 SPA）…"
npm -w @clinic/server run build
ok "服务器编译完成"

# ---- 6. systemd (needs sudo) ------------------------------------------------
log "配置 systemd 服务（开机自启 + 崩溃自动重启）…"
RUN_USER="$(stat -c '%U' "$REPO_DIR")"   # owner of the repo (your nvm user)
NODE_BIN="$(command -v node)"             # absolute path to nvm node, usable by systemd
$SUDO tee "$SERVICE_FILE" >/dev/null <<EOF
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
KillSignal=SIGTERM
TimeoutStopSec=15

[Install]
WantedBy=multi-user.target
EOF
$SUDO systemctl daemon-reload
$SUDO systemctl enable "$SERVICE_NAME" >/dev/null 2>&1
$SUDO systemctl restart "$SERVICE_NAME"
ok "服务已启动: systemctl status $SERVICE_NAME"

# ---- 7. (optional) Nginx + HTTPS — reuse existing cert if present -----------
setup_nginx() {
  log "配置 Nginx 反向代理…"
  command -v nginx >/dev/null 2>&1 || { $SUDO apt-get update -y && $SUDO apt-get install -y nginx; }

  read -r -p "  你的域名（例如 eyeclinic.dpdns.org，留空则只用 IP+HTTP）: " DOMAIN
  if [[ -z "$DOMAIN" ]]; then
    warn "未提供域名，配置为纯 HTTP（仅内网测试）。"
    $SUDO tee /etc/nginx/sites-available/clinic >/dev/null <<'EOF'
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
        proxy_read_timeout 60s;
    }
}
EOF
  else
    CERT_DIR="/etc/letsencrypt/live/${DOMAIN}"
    if $SUDO test -d "$CERT_DIR"; then
      ok "检测到已有证书 $CERT_DIR，复用（不重新申请，不影响自动续期）"
      $SUDO tee /etc/nginx/sites-available/clinic >/dev/null <<EOF
server {
    listen 80;
    server_name ${DOMAIN};
    return 301 https://\$host\$request_uri;
}
server {
    listen 443 ssl http2;
    server_name ${DOMAIN};
    ssl_certificate     ${CERT_DIR}/fullchain.pem;
    ssl_certificate_key ${CERT_DIR}/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    client_max_body_size 25m;
    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 60s;
    }
}
EOF
    else
      warn "未找到已有证书 $CERT_DIR，先配 HTTP 再用 certbot 申请"
      $SUDO tee /etc/nginx/sites-available/clinic >/dev/null <<EOF
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
  fi
  $SUDO ln -sf /etc/nginx/sites-available/clinic /etc/nginx/sites-enabled/clinic
  $SUDO rm -f /etc/nginx/sites-enabled/default
  $SUDO nginx -t && $SUDO systemctl reload nginx || die "Nginx 配置有误"
  ok "Nginx 已配置"

  if [[ -n "$DOMAIN" ]] && ! $SUDO test -d "/etc/letsencrypt/live/${DOMAIN}"; then
    log "申请 Let's Encrypt 证书…"
    command -v certbot >/dev/null 2>&1 || $SUDO apt-get install -y certbot python3-certbot-nginx
    if $SUDO certbot --nginx -n --redirect -d "$DOMAIN" --agree-tos -m "admin@${DOMAIN}"; then
      ok "HTTPS 已启用: https://${DOMAIN}"
    else
      warn "证书申请失败。确认域名已解析到本机后手动: sudo certbot --nginx -d ${DOMAIN}"
    fi
  fi
}

read -r -p "是否配置 Nginx 反向代理 + HTTPS？[y/N] " DO_NGINX
if [[ "${DO_NGINX:-N}" =~ ^[Yy]$ ]]; then
  setup_nginx
else
  warn "跳过 Nginx。直接访问 http://<服务器IP>:4000/（明文 HTTP）。"
fi

# ---- done -------------------------------------------------------------------
echo
ok "部署完成！"
echo -e "  后台管理:  ${C_G}http://<服务器IP>:4000/${C_0}  （或配置的域名）"
echo -e "  首次登录用 .env 里设置的后台密码"
echo
echo -e "  常用命令:"
echo -e "    systemctl status $SERVICE_NAME      # 查看状态"
echo -e "    journalctl -u $SERVICE_NAME -f      # 实时日志"
echo -e "    bash deploy/deploy.sh               # git pull 后重新构建+重启"
