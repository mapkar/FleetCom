# FleetCom mocks

Office dashboard and bus kiosk. Shared roster, demo messages. No MQTT yet.

| File | What it is |
|---|---|
| `office.html` | Dispatcher dashboard + roster editor |
| `bus.html` | Driver kiosk — pick assignment, then category grid |
| `fleet-store.js` | Shared roster load/save |
| `serve.py` | Local server that persists `data/roster.json` |
| `data/roster.json` | Office-maintained bus list |
| `PROJECT.md` | Design brief, topics, and message catalog |

## Roster fields

Each assignment the office creates has:

- **State bus number** — South Carolina format `508-6238` (3 digits, hyphen, 4 digits)
- **Route number**
- **Driver name**
- **Comment**

The bus kiosk only offers buses that are on this list. Drivers do not type a bus number.

Route number is the primary label in the UI. Driver name comes next, then the state bus number.

## Serve locally (Linux)

Use the project server so office and a tablet on the same machine/LAN share one roster file:

```bash
python3 serve.py
```

Then open:

- Office: http://127.0.0.1:8080/office.html
- Bus:    http://127.0.0.1:8080/bus.html

`serve.py` listens on `0.0.0.0:8080`, so a bus tablet can use `http://<this-pc-ip>:8080/bus.html`.

If you only run `python3 -m http.server 8080`, the roster stays in the browser (`localStorage`) and will not write `data/roster.json`. Fine for a single-browser demo; use `serve.py` when the office list should survive and be visible on another device.

## How it behaves

**Office**

- Left list is the roster (route first, then driver and state number)
- **+ Add bus** or double-click a row to edit
- State number is checked against `###-####`
- Center feed: All / Unacked / Priority; ACK / Deny / Dismiss
- Right panel: send to one assignment or broadcast

**Bus**

- First launch: choose route from the office list
- Choice is remembered on that device until **Switch**
- Pending office message: ACK / Deny / Dismiss
- Category tap → pre-written types only (no free text)

Message feed state is still in-memory for the session. The roster is what persists.
