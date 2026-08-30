# FleetCom — School Bus / Office Messaging System

Lightweight two-way messaging between school buses and the transportation office.

## Problem

The district uses **Tyler Drive** for routing, but it does not support live updates or messages between the office and buses. Everything currently goes over radios, which have poor coverage in some areas.

## Concept

Inspired by **ACARS**: short, structured, priority-aware messages with acknowledgements. Not free-form chat.

- Transport now: **MQTT over internet**
- Transport later: **LoRa / Meshtastic** (OconeeConnect mesh) using the same payload shape
- Must stay lightweight, self-hostable on Linux
- Office: web dashboard
- Bus: road-safe, glanceable UI (phone/tablet kiosk now; possible dedicated device + 4-button macro keypad later)

## Users

- Office / dispatcher
- School bus driver (must be usable while parked or with brief glances; no free typing while moving)

## Office UI

- Left: per-bus list (online/offline, last seen, priority flags)
- Center: new / priority / unacked message feed
- Right (desktop): compose panel
- Actions on incoming bus messages: Acknowledge, Deny, Dismiss
- Office can send to one bus or broadcast

## Bus UI

- Top status bar: route number + connection/power
- Pending office message banner with three large buttons: **ACK / Deny / Dismiss**
- Bottom 3×2 grid of large category buttons
- Category tap opens a short list of pre-written messages (no free text while moving)

### Bus category grid

1. Issue (student/behavior)
2. Mech
3. Delay
4. Route
5. Status
6. Emergency

## Message hierarchy

### Bus → Office

- **Delay:** traffic, weather, waiting_students, mechanical_delay, previous_route_late, other_delay
- **Mechanical:** warning_light, tire, brakes, door_lift, electronics, wont_start, other_mechanical
- **Student:** behavior, injury_medical, missing_student, extra_rider, fight, parent_confrontation
- **Route:** temp_stop_added, temp_stop_removed, reroute_road_closed, reroute_traffic, extra_stop_school, last_stop_complete
- **Status:** all_clear, boarding_complete, request_radio, request_call, fuel_low, capacity
- **Emergency:** assistance_needed, accident, medical_emergency, security_threat

### Office → Bus

route_adjustment, skip_stop, reroute, schedule_change, hold_at_school, confirm_count, confirm_location, call_office, radio_check, emergency_return, emergency_hold, weather_alert, security_notice, general_notice

### Priorities

`normal` | `high` | `emergency`

### Status values

`pending` | `acked` | `denied` | `dismissed`

## MQTT topics

```
fleet/
├── buses/{bus_id}/
│   ├── status          # retained last status
│   ├── location        # GPS later
│   ├── messages/out    # Bus → Office
│   ├── messages/in     # Office → Bus
│   └── ack
├── office/
│   ├── broadcast
│   └── messages
└── system/heartbeat
```

Broker: Automaton at `framland.duckdns.org` (WebSocket, or TCP 1883 via `serve.py`).

## JSON message shape (required fields)

`msg_id`, `timestamp` (ISO 8601 UTC), `sender`, `direction` (`bus_to_office` | `office_to_bus`), `priority`, `category`, `type`

Optional: `bus_id`, `payload` (object), `status`, `in_reply_to`, `text` (short human summary)

QoS 1 for operational messages. Retain latest status and location.

## Later features

- GPS map of buses
- Live travel / location view for office
- Meshtastic MQTT bridge
- Physical 4-button keypad under the screen for ACK/Deny/Dismiss/select while driving

## Constraints

- Keep UIs glanceable and one-handed
- No free-text entry while the bus is moving
- Be careful with student/behavior details (prefer coded categories)
- Self-host first (Linux, Docker/Mosquitto/Node-RED are fine)
- Prefer simple files and working mocks over heavy frameworks unless asked
- When producing planning notes, use clean Obsidian-friendly Markdown
- When producing code, prefer a working single-file HTML mock first, then split if needed

## Roster (office-maintained)

Each assignment:

- `state_number` — SC format `508-6238`
- `route_number` (primary label in the UI)
- `driver_name`
- `comment`

Stored in `data/roster.json` when served with `serve.py`. Bus kiosk picks from this list only (no typed bus number while in service).

## Current status

Office and bus UIs plus roster. Live MQTT via Automaton at `framland.duckdns.org` (`fleet-mqtt.js` WebSocket, `serve.py` TCP 1883 bridge).
