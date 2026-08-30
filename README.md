# FleetCom

Office dashboard and bus kiosk. Roster plus live MQTT through Automaton at `framland.duckdns.org`.

| File | What it is |
|---|---|
| `office.html` / `office.css` / `office.js` | Dispatcher dashboard + roster editor |
| `bus.html` / `bus.css` / `bus.js` | Driver kiosk |
| `fleet-store.js` | Shared roster load/save |
| `fleet-mqtt.js` / `mqtt-config.js` | MQTT client (WebSocket, then TCP bridge) |
| `mqtt.min.js` | Optional local MQTT.js bundle; falls back to unpkg |
| `serve.py` | Static files, roster API, MQTT TCP bridge |
| `data/roster.json` | Office-maintained bus list |
| `PROJECT.md` | Design brief, topics, and message catalog |

## MQTT

Default broker host: **framland.duckdns.org** (Automaton, via DuckDNS).

The browser tries MQTT over WebSocket first (`ws://framland.duckdns.org:9001/mqtt`, then 1884 / 8083 / 8000). If that fails, `serve.py` bridges to MQTT TCP **1883** on the same host.

Click the **MQTT** pill on the office header (or use the bus setup form) to set user/password and ports. Credentials stay in the browser (`localStorage`) and in `data/mqtt.json` on the machine running `serve.py` — that file is gitignored.

On Automaton / Mosquitto you need:

1. TCP 1883 reachable from the PC running `serve.py` (LAN or port-forward to `framland.duckdns.org`)
2. Optional WebSocket listener if you want the tablet to talk to the broker without `serve.py`:

```
listener 9001
protocol websockets
```

Allow topic `fleet/#` for the FleetCom clients.

### Topics in use

```
fleet/office/roster              retained JSON roster
fleet/office/broadcast           office → all buses
fleet/buses/{id}/messages/out    bus → office
fleet/buses/{id}/messages/in     office → one bus
fleet/buses/{id}/ack             ACK / Deny / Dismiss
fleet/buses/{id}/status          retained online/offline
fleet/system/heartbeat
```

QoS 1 on operational messages.

## Serve locally (Linux)

```bash
python3 serve.py
```

- Office: http://127.0.0.1:8080/office.html
- Bus:    http://127.0.0.1:8080/bus.html

`serve.py` listens on `0.0.0.0:8080`. A bus tablet on the LAN can use `http://<this-pc-ip>:8080/bus.html` and still reach Automaton through the TCP bridge.

## Roster fields

- **Route number** (primary label)
- **Driver name**
- **State bus number** — SC format `508-6238`
- **Comment**
