#!/usr/bin/env bash
set -euo pipefail

: "${SERVER_HOST:?SERVER_HOST is required}"
: "${APP_DOMAIN:?APP_DOMAIN is required}"
: "${ENABLE_LETSENCRYPT:?ENABLE_LETSENCRYPT is required}"
: "${LETSENCRYPT_EMAIL:=}"
: "${CUSTOM_SSL_CERT_PATH:=}"
: "${CUSTOM_SSL_KEY_PATH:=}"
: "${CUSTOM_SSL_CA_PATH:=}"
: "${DB_PASSWORD:?DB_PASSWORD is required}"
: "${APP_SECRET:?APP_SECRET is required}"
: "${DEMO_PASSWORD:?DEMO_PASSWORD is required}"
: "${TURN_PASSWORD:?TURN_PASSWORD is required}"
: "${LIVEKIT_API_KEY:?LIVEKIT_API_KEY is required}"
: "${LIVEKIT_API_SECRET:?LIVEKIT_API_SECRET is required}"

APP_DIR="/srv/tescord/app"
FRONTEND_DIR="/srv/tescord/frontend/browser"
ARCHIVE_PATH="/root/tescord-app.tar"
TEMP_EXTRACT_DIR="/tmp/tescord-release"
BACKEND_ENV_PATH="${APP_DIR}/backend/.env"
LIVEKIT_CONFIG_DIR="/etc/livekit"
LIVEKIT_CONFIG_PATH="${LIVEKIT_CONFIG_DIR}/livekit.yaml"
SELF_SIGNED_CERT="/etc/ssl/certs/tescord-selfsigned.crt"
SELF_SIGNED_KEY="/etc/ssl/private/tescord-selfsigned.key"
CUSTOM_SSL_DIR="/etc/nginx/ssl/${APP_DOMAIN}"
CUSTOM_SSL_CERT="${CUSTOM_SSL_DIR}/certificate.crt"
CUSTOM_SSL_CA="${CUSTOM_SSL_DIR}/certificate_ca.crt"
CUSTOM_SSL_FULLCHAIN="${CUSTOM_SSL_DIR}/fullchain.pem"
CUSTOM_SSL_KEY="${CUSTOM_SSL_DIR}/privkey.pem"

install_custom_ssl() {
  local source_cert="$1"
  local source_key="$2"
  local source_ca="${3:-}"

  mkdir -p "${CUSTOM_SSL_DIR}"
  install -m 644 "${source_cert}" "${CUSTOM_SSL_CERT}"
  install -m 600 "${source_key}" "${CUSTOM_SSL_KEY}"

  if [ -n "${source_ca}" ] && [ -f "${source_ca}" ]; then
    install -m 644 "${source_ca}" "${CUSTOM_SSL_CA}"
    cat "${CUSTOM_SSL_CERT}" "${CUSTOM_SSL_CA}" > "${CUSTOM_SSL_FULLCHAIN}"
  else
    cp "${CUSTOM_SSL_CERT}" "${CUSTOM_SSL_FULLCHAIN}"
  fi

  chmod 644 "${CUSTOM_SSL_FULLCHAIN}"
}

export DEBIAN_FRONTEND=noninteractive

apt-get update
apt-get install -y \
  git \
  rsync \
  nginx \
  postgresql \
  postgresql-contrib \
  redis-server \
  python3 \
  python3-venv \
  python3-pip \
  certbot \
  python3-certbot-nginx \
  coturn \
  openssl \
  curl

if ! id -u tescord >/dev/null 2>&1; then
  useradd --system --create-home --shell /bin/bash tescord
fi

mkdir -p "${APP_DIR}" "${FRONTEND_DIR}" /srv/tescord/tmp
rm -rf "${TEMP_EXTRACT_DIR}"
mkdir -p "${TEMP_EXTRACT_DIR}"
tar -xf "${ARCHIVE_PATH}" -C "${TEMP_EXTRACT_DIR}"

mkdir -p "${APP_DIR}/backend"
if [ ! -f "${BACKEND_ENV_PATH}" ]; then
  touch "${BACKEND_ENV_PATH}"
fi

rsync -a --delete \
  --exclude '.git' \
  --exclude 'backend/.venv' \
  --exclude 'backend/.env' \
  "${TEMP_EXTRACT_DIR}/" "${APP_DIR}/"

chown -R tescord:tescord /srv/tescord

if [ ! -d "${APP_DIR}/backend/.venv" ]; then
  python3 -m venv "${APP_DIR}/backend/.venv"
fi

"${APP_DIR}/backend/.venv/bin/python" -m pip install --upgrade pip
su -s /bin/bash -c "cd '${APP_DIR}/backend' && ./.venv/bin/pip install -e ." tescord

if ! su - postgres -c "psql -tAc \"SELECT 1 FROM pg_roles WHERE rolname='tescord'\"" | grep -q 1; then
  su - postgres -c "psql -c \"CREATE ROLE tescord LOGIN PASSWORD '${DB_PASSWORD}';\""
else
  su - postgres -c "psql -c \"ALTER ROLE tescord WITH PASSWORD '${DB_PASSWORD}';\""
fi

if ! su - postgres -c "psql -tAc \"SELECT 1 FROM pg_database WHERE datname='tescord'\"" | grep -q 1; then
  su - postgres -c "psql -c \"CREATE DATABASE tescord OWNER tescord;\""
fi

if [[ "${APP_DOMAIN}" == "${SERVER_HOST}" ]]; then
  CORS_JSON="[\"https://${SERVER_HOST}\"]"
  HOSTS_JSON="[\"${SERVER_HOST}\"]"
  TURN_HOST="${SERVER_HOST}"
else
  CORS_JSON="[\"https://${APP_DOMAIN}\",\"https://${SERVER_HOST}\"]"
  HOSTS_JSON="[\"${APP_DOMAIN}\",\"${SERVER_HOST}\"]"
  TURN_HOST="${APP_DOMAIN}"
fi

cat > "${BACKEND_ENV_PATH}" <<EOF
TESCORD_APP_NAME=Altgramm API
TESCORD_API_PREFIX=/api
TESCORD_ENVIRONMENT=production
TESCORD_DEBUG=false
TESCORD_DATABASE_URL=postgresql+psycopg://tescord:${DB_PASSWORD}@127.0.0.1:5432/tescord
TESCORD_CORS_ORIGINS=${CORS_JSON}
TESCORD_ALLOWED_HOSTS=${HOSTS_JSON}
TESCORD_SECRET_KEY=${APP_SECRET}
TESCORD_ACCESS_TOKEN_EXPIRE_MINUTES=10080
TESCORD_SEED_DEMO_DATA=true
TESCORD_DEMO_LOGIN=weren9000
TESCORD_DEMO_NICK=weren9000
TESCORD_DEMO_FULL_NAME=Верен Чебыкин
TESCORD_DEMO_CHARACTER_NAME=Архимаг Кельн
TESCORD_DEMO_PASSWORD=${DEMO_PASSWORD}
TESCORD_DEMO_IS_ADMIN=true
TESCORD_DEMO_SERVER_NAME=Altgramm
TESCORD_LIVEKIT_URL=wss://${APP_DOMAIN}/livekit
TESCORD_LIVEKIT_API_KEY=${LIVEKIT_API_KEY}
TESCORD_LIVEKIT_API_SECRET=${LIVEKIT_API_SECRET}
EOF

chown tescord:tescord "${BACKEND_ENV_PATH}"
chmod 600 "${BACKEND_ENV_PATH}"

su -s /bin/bash -c "cd '${APP_DIR}/backend' && ./.venv/bin/python -m alembic upgrade head" tescord

if ! command -v livekit-server >/dev/null 2>&1; then
  curl -sSL https://get.livekit.io | bash
fi

mkdir -p "${LIVEKIT_CONFIG_DIR}"
cat > "${LIVEKIT_CONFIG_PATH}" <<EOF
port: 7880
redis:
  address: 127.0.0.1:6379
rtc:
  port_range_start: 50000
  port_range_end: 60000
  tcp_port: 7881
  use_external_ip: true
keys:
  ${LIVEKIT_API_KEY}: ${LIVEKIT_API_SECRET}
EOF

cat > /etc/systemd/system/tescord-livekit.service <<EOF
[Unit]
Description=LiveKit SFU server
After=network.target redis-server.service
Wants=redis-server.service

[Service]
User=tescord
Group=tescord
ExecStart=/usr/local/bin/livekit-server --config ${LIVEKIT_CONFIG_PATH}
Restart=always
RestartSec=5
LimitNOFILE=500000

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/systemd/system/tescord-backend.service <<EOF
[Unit]
Description=Altgramm FastAPI backend
After=network.target postgresql.service redis-server.service tescord-livekit.service
Wants=postgresql.service redis-server.service tescord-livekit.service

[Service]
User=tescord
Group=tescord
WorkingDirectory=${APP_DIR}/backend
EnvironmentFile=${BACKEND_ENV_PATH}
ExecStart=${APP_DIR}/backend/.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 --proxy-headers
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

mkdir -p /etc/ssl/private /etc/ssl/certs /etc/nginx/ssl
if [ ! -f "${SELF_SIGNED_CERT}" ] || [ ! -f "${SELF_SIGNED_KEY}" ]; then
  openssl req -x509 -nodes -newkey rsa:2048 \
    -keyout "${SELF_SIGNED_KEY}" \
    -out "${SELF_SIGNED_CERT}" \
    -days 365 \
    -subj "/CN=${APP_DOMAIN}"
fi

SSL_CERT_PATH="${SELF_SIGNED_CERT}"
SSL_KEY_PATH="${SELF_SIGNED_KEY}"
ACTIVE_SSL_MODE="self-signed"

if [ -n "${CUSTOM_SSL_CERT_PATH}" ] || [ -n "${CUSTOM_SSL_KEY_PATH}" ] || [ -n "${CUSTOM_SSL_CA_PATH}" ]; then
  if [ -z "${CUSTOM_SSL_CERT_PATH}" ] || [ -z "${CUSTOM_SSL_KEY_PATH}" ]; then
    echo "CUSTOM_SSL_CERT_PATH and CUSTOM_SSL_KEY_PATH must be provided together." >&2
    exit 1
  fi

  if [ ! -f "${CUSTOM_SSL_CERT_PATH}" ] || [ ! -f "${CUSTOM_SSL_KEY_PATH}" ]; then
    echo "Custom SSL certificate or key file not found." >&2
    exit 1
  fi

  install_custom_ssl "${CUSTOM_SSL_CERT_PATH}" "${CUSTOM_SSL_KEY_PATH}" "${CUSTOM_SSL_CA_PATH}"
  rm -f "${CUSTOM_SSL_CERT_PATH}" "${CUSTOM_SSL_KEY_PATH}"
  if [ -n "${CUSTOM_SSL_CA_PATH}" ]; then
    rm -f "${CUSTOM_SSL_CA_PATH}"
  fi

  SSL_CERT_PATH="${CUSTOM_SSL_FULLCHAIN}"
  SSL_KEY_PATH="${CUSTOM_SSL_KEY}"
  ACTIVE_SSL_MODE="custom"
elif [ -f "${CUSTOM_SSL_FULLCHAIN}" ] && [ -f "${CUSTOM_SSL_KEY}" ]; then
  SSL_CERT_PATH="${CUSTOM_SSL_FULLCHAIN}"
  SSL_KEY_PATH="${CUSTOM_SSL_KEY}"
  ACTIVE_SSL_MODE="custom"
fi

cat > /etc/nginx/sites-available/tescord <<EOF
server {
    listen 80;
    server_name ${APP_DOMAIN};
    return 301 https://\$host\$request_uri;
}

server {
    listen 443 ssl http2;
    server_name ${APP_DOMAIN};
    client_max_body_size 500m;

    ssl_certificate ${SSL_CERT_PATH};
    ssl_certificate_key ${SSL_KEY_PATH};

    root ${FRONTEND_DIR};
    index index.html;

    location / {
        try_files \$uri \$uri/ /index.html;
    }

    location /runtime-config.js {
        add_header Cache-Control "no-store";
        try_files \$uri =404;
    }

    location = /livekit {
        return 301 /livekit/;
    }

    location /livekit/ {
        proxy_pass http://127.0.0.1:7880/;
        proxy_http_version 1.1;
        proxy_buffering off;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:8000/api/;
        proxy_http_version 1.1;
        proxy_request_buffering off;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
EOF

rm -f /etc/nginx/sites-enabled/default
ln -sf /etc/nginx/sites-available/tescord /etc/nginx/sites-enabled/tescord

cat > /etc/turnserver.conf <<EOF
listening-port=3478
listening-ip=${SERVER_HOST}
relay-ip=${SERVER_HOST}
external-ip=${SERVER_HOST}
fingerprint
lt-cred-mech
realm=${APP_DOMAIN}
server-name=${APP_DOMAIN}
user=tescordturn:${TURN_PASSWORD}
total-quota=600
bps-capacity=0
stale-nonce=600
no-cli
min-port=49160
max-port=49999
simple-log
EOF

if [ -f /etc/default/coturn ]; then
  sed -i 's/^#TURNSERVER_ENABLED=.*/TURNSERVER_ENABLED=1/' /etc/default/coturn
  sed -i 's/^TURNSERVER_ENABLED=.*/TURNSERVER_ENABLED=1/' /etc/default/coturn
  if ! grep -q '^TURNSERVER_ENABLED=1' /etc/default/coturn; then
    echo 'TURNSERVER_ENABLED=1' >> /etc/default/coturn
  fi
fi

systemctl daemon-reload
systemctl enable postgresql redis-server nginx coturn tescord-livekit tescord-backend
systemctl restart postgresql
systemctl restart redis-server
systemctl restart tescord-livekit
systemctl restart coturn
nginx -t
systemctl restart nginx
systemctl restart tescord-backend

if [ "${ACTIVE_SSL_MODE}" != "custom" ] && [ "${ENABLE_LETSENCRYPT}" = "true" ] && [ -n "${LETSENCRYPT_EMAIL}" ]; then
  certbot --nginx --non-interactive --agree-tos -m "${LETSENCRYPT_EMAIL}" -d "${APP_DOMAIN}" --redirect || true
  nginx -t
  systemctl reload nginx
fi

echo "Deployment complete."
echo "SSL mode: ${ACTIVE_SSL_MODE}"
