import { storage } from "../storage";

const NEW_MODELS = [
    {
        name: "Gemini 3.1 Pro",
        provider: "google",
        modelId: "gemini-3.1-pro-preview",
        description: "Google Gemini 3.1 Pro Preview",
        isEnabled: "true",
        status: "active",
        displayOrder: 5,
        modelType: "chat",
        contextWindow: 2000000,
        icon: "sparkles"
    },
    {
        name: "Gemini 1.5 Flash",
        provider: "google",
        modelId: "gemini-1.5-flash",
        description: "Google Gemini 1.5 Flash",
        isEnabled: "true",
        status: "active",
        displayOrder: 10,
        modelType: "chat",
        contextWindow: 1000000,
        icon: "sparkles"
    },
    {
        name: "GPT-4o Mini",
        provider: "openai",
        modelId: "gpt-4o-mini",
        description: "OpenAI GPT-4o Mini",
        isEnabled: "true",
        status: "active",
        displayOrder: 11,
        modelType: "chat",
        contextWindow: 128000,
        icon: "sparkles"
    },
    {
        name: "Grok 2.0 (Latest)",
        provider: "xai",
        modelId: "grok-3-mini",
        description: "XAI Grok 2.0 - Fast and capable.",
        isEnabled: "true",
        status: "active",
        displayOrder: 20,
        modelType: "chat",
        contextWindow: 128000,
        icon: "sparkles"
    }
];

async function seedModels() {
    console.log("🌱 Seeding AI Models...");
    try {
        const existingModels = await storage.getAiModels();
        for (const model of NEW_MODELS) {
            const exists = existingModels.find(m => m.modelId === model.modelId);
            if (!exists) {
                console.log(`➕ Adding model: ${model.name} (${model.modelId})`);
                await storage.createAiModel({
                    ...model,
                    enabledAt: new Date(),
                    enabledByAdminId: "system_seed"
                });
            } else {
                console.log(`✅ Model already exists: ${model.name}, updating status to active`);
                await storage.updateAiModel(exists.id, {
                    isEnabled: "true",
                    status: "active"
                });
            }
        }
        console.log("✨ Model seeding complete.");
    } catch (error) {
        console.error("❌ Error seeding models:", error);
        process.exit(1);
    }
}

seedModels().catch(console.error);
