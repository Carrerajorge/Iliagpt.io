import { syncAllProviders } from "../services/aiModelSyncService";
import { db } from "../db";
import { aiModels } from "@shared/schema";
import { eq } from "drizzle-orm";
import { isChatModelType, normalizeModelProviderToRuntime, isChatModelIdCompatible } from "../services/modelIntegration";

async function run() {
  // 1) Sync all known models into the DB
  console.log("=== Syncing all providers ===");
  const syncResults = await syncAllProviders();
  for (const [provider, result] of Object.entries(syncResults)) {
    if (result.added > 0 || result.updated > 0 || result.errors.length > 0) {
      console.log(`  ${provider}: +${result.added} added, ${result.updated} updated, ${result.errors.length} errors`);
    }
  }

  // 2) Activate all chat-capable, non-deprecated models
  console.log("\n=== Activating all chat-capable models ===");
  const allModels = await db
    .select({
      id: aiModels.id,
      modelId: aiModels.modelId,
      provider: aiModels.provider,
      modelType: aiModels.modelType,
      isEnabled: aiModels.isEnabled,
      status: aiModels.status,
      name: aiModels.name,
      isDeprecated: aiModels.isDeprecated,
    })
    .from(aiModels);

  let enabled = 0;
  let alreadyActive = 0;
  let skipped = 0;

  for (const model of allModels) {
    if (model.isDeprecated === "true") {
      skipped++;
      continue;
    }
    if (!isChatModelType(model.modelType)) {
      skipped++;
      continue;
    }

    const runtime = normalizeModelProviderToRuntime(model.provider);
    if (!runtime) {
      skipped++;
      continue;
    }
    if (!isChatModelIdCompatible(runtime, model.modelId)) {
      skipped++;
      continue;
    }

    if (model.status === "active" && model.isEnabled === "true") {
      alreadyActive++;
      continue;
    }

    await db
      .update(aiModels)
      .set({
        status: "active",
        isEnabled: "true",
        enabledAt: new Date(),
      })
      .where(eq(aiModels.id, model.id));
    enabled++;
    console.log(`  Enabled: ${model.name} (${model.provider}/${model.modelId})`);
  }

  console.log(`\n=== Summary ===`);
  console.log(`  Total models in DB: ${allModels.length}`);
  console.log(`  Newly enabled: ${enabled}`);
  console.log(`  Already active: ${alreadyActive}`);
  console.log(`  Skipped (deprecated/non-chat): ${skipped}`);

  // 3) Final verification
  console.log("\n=== Active Models (by provider) ===");
  const active = await db
    .select({
      name: aiModels.name,
      provider: aiModels.provider,
      modelId: aiModels.modelId,
      modelType: aiModels.modelType,
    })
    .from(aiModels)
    .where(eq(aiModels.isEnabled, "true"));

  const byProvider: Record<string, string[]> = {};
  for (const m of active) {
    if (!byProvider[m.provider]) byProvider[m.provider] = [];
    byProvider[m.provider].push(`${m.name} (${m.modelId}) [${m.modelType}]`);
  }
  for (const [prov, models] of Object.entries(byProvider)) {
    console.log(`\n  ${prov.toUpperCase()} (${models.length} models):`);
    for (const m of models) console.log(`    - ${m}`);
  }

  process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
