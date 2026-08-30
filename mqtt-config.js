/* Default broker: Automaton, reached at the house DDNS name.
   Username/password are NOT stored in the repo. Enter them in the
   office/bus MQTT form (browser localStorage) or in data/mqtt.json
   on the machine that runs serve.py / launch.sh. */
window.FLEET_MQTT_DEFAULTS = {
  host: "framland.duckdns.org",
  wsPort: 9001,
  wssPort: 443,
  wsPath: "/mqtt",
  tcpPort: 1883,
  useTLS: false,
  username: "",
  password: "",
  altWsPorts: [1884, 8083, 9001, 8000]
};
