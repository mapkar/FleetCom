# FleetCom

Office dashboard and bus kiosk. Roster plus live MQTT through Automaton at `framland.duckdns.org`.

| File | What it is |
|---|---|
| `index.html` | BIOS-style landing / POST screen (bus or office) |
| `office.html` / `office.css` / `office.js` | Dispatcher dashboard + roster editor |
| `bus.html` / `bus.css` / `bus.js` | Driver kiosk |
| `fleet-store.js` | Shared roster load/save |
| `fleet-notify.js` | Short ding for incoming messages and driver replies |
| `fleet-mqtt.js` / `mqtt-config.js` / `mqtt.min.js` | MQTT client (WebSocket, then TCP bridge) |
| `serve.py` | Static files, roster API, MQTT TCP bridge |
| `launch.sh` | Automaton install / git update / WSS listener |
| `data/mqtt.example.json` | Template for server-side MQTT config |
| `data/mqtt.json` | Live creds on the server only (gitignored) |
| `data/roster.json` | Office-maintained bus list |
| `PROJECT.md` | Design brief, topics, and message catalog |

Apache on Automaton serves this tree at **`/acars/`**. Opening that path loads `index.html`.

## MQTT

Default broker host: **framland.duckdns.org** (Automaton, via DuckDNS).

**Credentials are not in the repo.** On Automaton (or any host running `serve.py`):

```bash
cp data/mqtt.example.json data/mqtt.json
# edit password (and optional letsencrypt_email)
sudo bash launch.sh          # first time
sudo bash launch.sh update   # later git pull + restart
sudo bash launch.sh wss      # HTTPS + wss://…/mqtt for GitHub Pages
sudo bash launch.sh creds    # re-apply data/mqtt.json to Mosquitto
```

`data/mqtt.json` is gitignored. The browser still keeps whatever you type in the MQTT dialog (`localStorage`) so a tablet can connect without reading the server file.

- From **HTTP** (Apache `/acars/` or `serve.py :8080`): `ws://framland.duckdns.org:9001/mqtt`, then the `serve.py` TCP bridge.
- From **HTTPS GitHub Pages**: only `wss://framland.duckdns.org/mqtt` (port 443). Plain `ws://` is blocked as mixed content, and Pages has no `/api` bridge.

That WSS listener is Apache on Automaton: TLS on 443, proxy `/mqtt` to Mosquitto WebSocket on `127.0.0.1:9001`. The house router must forward **TCP 443**.

Automaton rejects anonymous MQTT (`CONNACK 5`). Use the username/password from `data/mqtt.json`. Allow topic `fleet/#` for that user.

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

- Landing: http://127.0.0.1:8080/
- Office:  http://127.0.0.1:8080/office.html
- Bus:     http://127.0.0.1:8080/bus.html

`serve.py` listens on `0.0.0.0:8080`. A bus tablet on the LAN can use `http://<this-pc-ip>:8080/` and pick **Bus mode**.

## Live traffic

Office feed starts empty and only shows real MQTT traffic (plus messages you compose). Route labels read **Route: 42**. Delete a route from the selected-assignment card or the edit dialog.

Office shows **Driver confirmed / denied / dismissed** on messages the bus answers. Bus keeps a priority-sorted queue of office messages and dings on each new one. Office dings on a new bus report and again when the driver replies.

## Roster fields

- **Route number** (primary label)
- **Driver name**
- **State bus number** — SC format `508-6238`
- **Comment**
