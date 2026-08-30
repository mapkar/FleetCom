#!/bin/bash
# FleetCom on Automaton — MQTT creds, serve.py service, Apache /api proxy.
# Run on the server:
#   cd /var/www/html/acars   # or wherever the FleetCom files live
#   sudo bash launch.sh
set -euo pipefail

MQTT_USER="fleet"
MQTT_PASS="bus"
MQTT_HOST="framland.duckdns.org"
MQTT_PORT="1883"
HTTP_PORT="8080"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root: sudo bash $0"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -f "$SCRIPT_DIR/serve.py" ]; then
  APP_DIR="$SCRIPT_DIR"
elif [ -f /var/www/html/acars/serve.py ]; then
  APP_DIR=/var/www/html/acars
elif [ -f /var/www/acars/serve.py ]; then
  APP_DIR=/var/www/acars
else
  echo "Cannot find serve.py. Copy this script into the FleetCom folder and run it from there."
  exit 1
fi

PY="$(command -v python3 || true)"
if [ -z "$PY" ]; then
  echo "python3 not found"
  exit 1
fi

echo "App dir: $APP_DIR"
mkdir -p "$APP_DIR/data"

cat > "$APP_DIR/data/mqtt.json" <<EOF
{
  "host": "$MQTT_HOST",
  "port": $MQTT_PORT,
  "username": "$MQTT_USER",
  "password": "$MQTT_PASS",
  "client_id": "fleetcom-bridge"
}
EOF
chmod 600 "$APP_DIR/data/mqtt.json"
echo "Wrote $APP_DIR/data/mqtt.json (user $MQTT_USER)"

# Stop any leftover hand-started copy so systemd can bind :8080
pkill -f "$APP_DIR/serve.py" 2>/dev/null || true
fuser -k "${HTTP_PORT}/tcp" 2>/dev/null || true
sleep 1

cat > /etc/systemd/system/fleetcom.service <<EOF
[Unit]
Description=FleetCom office/bus server + MQTT TCP bridge
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$APP_DIR
ExecStart=$PY $APP_DIR/serve.py
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now fleetcom
sleep 1
systemctl --no-pager --full status fleetcom || true

# Apache: keep /acars static files, send /api to serve.py
if command -v a2enmod >/dev/null 2>&1; then
  a2enmod proxy proxy_http >/dev/null
  cat > /etc/apache2/conf-available/fleetcom-api.conf <<EOF
ProxyPreserveHost On
ProxyPass        /api/ http://127.0.0.1:${HTTP_PORT}/api/
ProxyPassReverse /api/ http://127.0.0.1:${HTTP_PORT}/api/
EOF
  a2enconf fleetcom-api >/dev/null
  systemctl reload apache2
  echo "Apache proxy: /api/ -> 127.0.0.1:${HTTP_PORT}/api/"
elif command -v apachectl >/dev/null 2>&1 && [ -d /etc/httpd ]; then
  cat > /etc/httpd/conf.d/fleetcom-api.conf <<EOF
ProxyPreserveHost On
ProxyPass        /api/ http://127.0.0.1:${HTTP_PORT}/api/
ProxyPassReverse /api/ http://127.0.0.1:${HTTP_PORT}/api/
EOF
  apachectl graceful || systemctl reload httpd || true
  echo "httpd proxy: /api/ -> 127.0.0.1:${HTTP_PORT}/api/"
else
  echo "Apache not found — use http://THISHOST:${HTTP_PORT}/office.html directly"
fi

echo
echo "Checks:"
curl -sS "http://127.0.0.1:${HTTP_PORT}/api/mqtt/status" || true
echo
echo
echo "Open:"
echo "  http://framland.duckdns.org/acars/office.html"
echo "  http://framland.duckdns.org:${HTTP_PORT}/office.html"
echo "MQTT dialog: user ${MQTT_USER}  password ${MQTT_PASS}  TLS off"
echo "Done."
