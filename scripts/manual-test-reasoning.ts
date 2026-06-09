import "dotenv/config";
import { llmGateway } from "../server/lib/llmGateway";

async function run(model: string, label: string) {
  console.log(`\n=== ${label} (${model}) ===`);
  let reasoningChars = 0, contentChars = 0, reasoningChunks = 0, details: unknown[] | null = null;
  let firstReasoning = "", firstContent = "";
  const gen = (llmGateway as any).streamChat(
    [{ role: "user", content: "¿Cuánto es 17 * 23?" }],
    { model, provider: "openai", userId: "manual-test", requestId: `manual_${label}`, maxTokens: 600, enableFallback: false },
  );
  for await (const chunk of gen) {
    if (chunk.reasoning) {
      reasoningChunks++;
      reasoningChars += chunk.reasoning.length;
      if (!firstReasoning) firstReasoning = chunk.reasoning.slice(0, 80);
    }
    if (chunk.content) {
      contentChars += chunk.content.length;
      if (!firstContent) firstContent = chunk.content.slice(0, 80);
    }
    if (chunk.done && chunk.reasoningDetails) details = chunk.reasoningDetails;
    if (chunk.done) break;
  }
  console.log(`reasoning: ${reasoningChunks} chunks, ${reasoningChars} chars | first: ${JSON.stringify(firstReasoning)}`);
  console.log(`content:   ${contentChars} chars | first: ${JSON.stringify(firstContent)}`);
  console.log(`reasoningDetails: ${details ? `array(${(details as unknown[]).length})` : "none"}`);
}

(async () => {
  await run("deepseek/deepseek-r1", "REASONING");
  await run("openai/gpt-4o-mini", "NO-REASONING");
  process.exit(0);
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
