/**
 * Spike probe: subscribes to every app event on the node's MQTT broker and prints what arrives.
 *   bun scripts/mqtt-probe.ts [mqtt://127.0.0.1:8883]
 */
import mqtt from "mqtt";

const url = process.argv[2] ?? "mqtt://127.0.0.1:8883";
const client = mqtt.connect(url);
client.on("connect", () => {
  console.log(`connected to ${url}`);
  client.subscribe("app/#");
});
client.on("message", (topic, payload) => {
  console.log(`message ${topic} ${payload.toString()}`);
});
client.on("error", (e) => console.error("mqtt error", e.message));
