#!/bin/bash
# FleetCom on Automaton.
#
# Secrets live in data/mqtt.json on this machine only (gitignored).
# Copy data/mqtt.example.json → data/mqtt.json and edit the password
# before the first run.
#
#   sudo bash launch.sh          # full install: creds, service, Apache /api + WSS
#   sudo bash launch.sh update   # git pull + restart fleetcom
#   sudo bash launch.sh wss      # cert + Apache wss://…/mqtt → Mosquitto :9001
#   sudo bash launch.sh creds    # apply data/mqtt.json to Mosquitto + file perms
#
set -euo pipefail

CMD="${1:-install}"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root: sudo bash $0 $CMD"
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

HTTP_PORT="8080"
MQTT_JSON="$APP_DIR/data/mqtt.json"
MQTT_EXAMPLE="$APP_DIR/data/mqtt.example.json"
MOSQ_PASSWD="/etc/mosquitto/passwd"
MOSQ_ACL="/etc/mosquitto/acl"

echo "App dir: $APP_DIR"
mkdir -p "$APP_DIR/data"

read_mqtt_field() {
  local key="$1"
  local fallback="${2:-}"
  if [ ! -f "$MQTT_JSON" ]; then
    printf '%s' "$fallback"
    return
  fi
  "$PY" - "$MQTT_JSON" "$key" "$fallback" <<'PY'
import json, sys
path, key, fallback = sys.argv[1], sys.argv[2], sys.argv[3]
try:
    data = json.load(open(path, encoding="utf-8"))
except Exception:
    print(fallback, end="")
    raise SystemExit
val = data.get(key, fallback)
if val is None:
    val = fallback
print(val, end="")
PY
}

ensure_mqtt_json() {
  if [ -f "$MQTT_JSON" ]; then
    local pass
    pass="$(read_mqtt_field password "")"
    if [ -z "$pass" ] || [ "$pass" = "CHANGE-ME" ]; then
      echo "Edit $MQTT_JSON and set a real password (not CHANGE-ME)."
      exit 1
    fi
    chmod 600 "$MQTT_JSON"
    return
  fi
  if [ ! -f "$MQTT_EXAMPLE" ]; then
    echo "Missing $MQTT_EXAMPLE and $MQTT_JSON."
    echo "Create $MQTT_JSON with host, port, username, password."
    exit 1
  fi
  cp "$MQTT_EXAMPLE" "$MQTT_JSON"
  chmod 600 "$MQTT_JSON"
  echo "Created $MQTT_JSON from the example."
  echo "Edit the password in that file, then run: sudo bash $0 $CMD"
  exit 1
}

apply_mosquitto_user() {
  local user pass
  user="$(read_mqtt_field username fleet)"
  pass="$(read_mqtt_field password "")"
  if ! command -v mosquitto_passwd >/dev/null 2>&1; then
    echo "mosquitto_passwd not found — skipped broker user update."
    return
  fi
  if [ -f "$MOSQ_PASSWD" ]; then
    mosquitto_passwd -b "$MOSQ_PASSWD" "$user" "$pass"
  else
    mkdir -p "$(dirname "$MOSQ_PASSWD")"
    mosquitto_passwd -c -b "$MOSQ_PASSWD" "$user" "$pass"
  fi
  chmod 640 "$MOSQ_PASSWD"
  chown root:mosquitto "$MOSQ_PASSWD" 2>/dev/null || true

  if [ ! -f "$MOSQ_ACL" ]; then
    cat > "$MOSQ_ACL" <<EOF
# FleetCom — created by launch.sh. Safe to edit.
user $user
topic readwrite fleet/#
EOF
    chmod 640 "$MOSQ_ACL"
    chown root:mosquitto "$MOSQ_ACL" 2>/dev/null || true
  elif ! grep -q "^user ${user}$" "$MOSQ_ACL" 2>/dev/null; then
    printf '\nuser %s\ntopic readwrite fleet/#\n' "$user" >> "$MOSQ_ACL"
  fi

  if [ -d /etc/mosquitto/conf.d ]; then
    cat > /etc/mosquitto/conf.d/fleetcom.conf <<EOF
# FleetCom auth. Listeners stay in your existing Mosquitto config
# (TCP 1883 and WebSocket 9001 are already running on Automaton).
allow_anonymous false
password_file $MOSQ_PASSWD
acl_file $MOSQ_ACL
EOF
  fi

  if command -v systemctl >/dev/null 2>&1; then
    systemctl reload mosquitto 2>/dev/null || systemctl restart mosquitto 2>/dev/null || true
  fi
  echo "Mosquitto user '$user' updated from $MQTT_JSON"
}

install_service() {
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
}

install_apache_api() {
  if command -v a2enmod >/dev/null 2>&1; then
    a2enmod proxy proxy_http proxy_wstunnel ssl rewrite headers >/dev/null
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
}

# GitHub Pages is HTTPS, so the browser will only talk WSS.
# Terminate TLS on Apache :443 and proxy /mqtt to local Mosquitto WS :9001.
install_wss() {
  local domain ws_port ws_path email
  domain="$(read_mqtt_field domain "")"
  if [ -z "$domain" ]; then
    domain="$(read_mqtt_field host framland.duckdns.org)"
  fi
  ws_port="$(read_mqtt_field ws_port 9001)"
  ws_path="$(read_mqtt_field ws_path /mqtt)"
  email="$(read_mqtt_field letsencrypt_email "")"

  if ! command -v a2enmod >/dev/null 2>&1; then
    echo "Apache + a2enmod required for the WSS proxy."
    exit 1
  fi

  a2enmod proxy proxy_http proxy_wstunnel ssl rewrite headers >/dev/null

  cat > /etc/apache2/conf-available/fleetcom-wss.conf <<EOF
# GitHub Pages (https://mapkar.github.io/FleetCom/) can only open wss://
# This proxies wss://${domain}${ws_path} → ws://127.0.0.1:${ws_port}${ws_path}
ProxyPreserveHost On
ProxyRequests Off
<Location ${ws_path}>
    ProxyPass        ws://127.0.0.1:${ws_port}${ws_path}
    ProxyPassReverse ws://127.0.0.1:${ws_port}${ws_path}
</Location>
EOF
  a2enconf fleetcom-wss >/dev/null

  if ! command -v certbot >/dev/null 2>&1; then
    if command -v apt-get >/dev/null 2>&1; then
      apt-get update -qq
      DEBIAN_FRONTEND=noninteractive apt-get install -y certbot python3-certbot-apache
    else
      echo "Install certbot, then rerun: sudo bash $0 wss"
      systemctl reload apache2 || true
      return
    fi
  fi

  if [ -n "$email" ]; then
    certbot --apache -d "$domain" --non-interactive --agree-tos --email "$email" --redirect || true
  else
    certbot --apache -d "$domain" --non-interactive --agree-tos --register-unsafely-without-email --redirect || true
  fi

  systemctl reload apache2 || true

  if command -v ufw >/dev/null 2>&1; then
    ufw allow 443/tcp >/dev/null 2>&1 || true
  fi

  echo
  echo "WSS target: wss://${domain}${ws_path}"
  echo "Mosquitto WS origin: ws://127.0.0.1:${ws_port}${ws_path}"
  echo
  echo "Router/firewall must forward TCP 443 to Automaton."
  echo "Port 443 was closed from the public internet last time we probed it."
}

git_update() {
  if [ ! -d "$APP_DIR/.git" ]; then
    echo "$APP_DIR is not a git clone."
    echo "Either:"
    echo "  cd /var/www/html && git clone https://github.com/mapkar/FleetCom.git acars"
    echo "or copy the new files into $APP_DIR, then:"
    echo "  sudo systemctl restart fleetcom"
    return
  fi
  echo "git pull in $APP_DIR"
  git -C "$APP_DIR" fetch origin
  git -C "$APP_DIR" pull --ff-only origin main || git -C "$APP_DIR" pull --ff-only
  if [ -f /etc/systemd/system/fleetcom.service ]; then
    systemctl restart fleetcom
    systemctl --no-pager --full status fleetcom || true
  fi
  if command -v systemctl >/dev/null 2>&1; then
    systemctl reload apache2 2>/dev/null || systemctl reload httpd 2>/dev/null || true
  fi
}

print_checks() {
  local host user
  host="$(read_mqtt_field host framland.duckdns.org)"
  user="$(read_mqtt_field username fleet)"
  echo
  echo "Checks:"
  curl -sS "http://127.0.0.1:${HTTP_PORT}/api/mqtt/status" || true
  echo
  echo
  echo "Open (HTTP, local / LAN):"
  echo "  http://${host}/acars/office.html"
  echo "  http://${host}:${HTTP_PORT}/office.html"
  echo "GitHub Pages (needs WSS on 443):"
  echo "  https://mapkar.github.io/FleetCom/office.html"
  echo "MQTT dialog: user ${user}  password from $MQTT_JSON  TLS on for Pages"
  echo "Done."
}

case "$CMD" in
  install)
    ensure_mqtt_json
    apply_mosquitto_user
    install_service
    install_apache_api
    install_wss
    print_checks
    ;;
  update)
    git_update
    if [ -f "$MQTT_JSON" ]; then
      print_checks
    fi
    ;;
  wss)
    ensure_mqtt_json
    install_apache_api
    install_wss
    print_checks
    ;;
  creds)
    ensure_mqtt_json
    apply_mosquitto_user
    if [ -f /etc/systemd/system/fleetcom.service ]; then
      systemctl restart fleetcom
    fi
    print_checks
    ;;
  *)
    echo "Usage: sudo bash $0 [install|update|wss|creds]"
    exit 1
    ;;
esac
