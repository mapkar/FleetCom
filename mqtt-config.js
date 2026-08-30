/* Default broker: Automaton, reached at the house DDNS name.
   Override in the MQTT settings dialog; values persist in localStorage. */
window.FLEET_MQTT_DEFAULTS = {
  host: "framland.duckdns.org",
  wsPort: 9001,
  wsPath: "/mqtt",
  tcpPort: 1883,
  useTLS: false,
  username: "",
  password: "",
  altWsPorts: [1884, 8083, 9001, 8000]
};
