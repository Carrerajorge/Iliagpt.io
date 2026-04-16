import { db } from "../db";
import { sql } from "drizzle-orm";

async function run() {
  const models = await db.execute(sql`
    SELECT name, provider, model_id, display_order, model_type
    FROM ai_models
    WHERE is_enabled = 'true' AND status = 'active' AND model_type IN ('TEXT', 'MULTIMODAL')
    ORDER BY display_order ASC, provider ASC, name ASC
  `);
  console.log("Active chat-capable models (" + models.rows.length + "):\n");
  let lastProvider = "";
  for (const m of models.rows as any[]) {
    if (m.provider !== lastProvider) {
      console.log("\n  " + m.provider.toUpperCase() + ":");
      lastProvider = m.provider;
    }
    console.log("    [" + (m.display_order || 0) + "] " + m.name + " (" + m.model_id + ") " + m.model_type);
  }
  process.exit(0);
}
run().catch(e => { console.error(e); process.exit(1); });
