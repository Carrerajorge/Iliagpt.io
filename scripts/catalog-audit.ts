import { buildDefaultCapabilityCatalog } from "../server/cognitive/capabilityCatalog";
import { buildCapabilityHandlerMap } from "../server/cognitive/capabilityHandlers";

const registry = buildDefaultCapabilityCatalog({ handlers: buildCapabilityHandlerMap() });
const all = registry.list();
let available = 0;
let stub = 0;
const stubs: string[] = [];
for (const d of all) {
  if (d.status === "available") available++;
  else stub++;
  if (d.status === "stub") stubs.push(`${d.category.padEnd(22)} ${d.id}`);
}
console.log(`Total: ${all.length} | Available: ${available} | Stubs: ${stub}`);
console.log("Remaining stubs:");
for (const s of stubs.sort()) console.log("  " + s);
