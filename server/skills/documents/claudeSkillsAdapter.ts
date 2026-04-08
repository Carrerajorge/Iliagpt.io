/** Claude Skills Adapter — delegates document generation to Claude's native Skills API.
 *  Returns null gracefully if API key is missing, SDK not installed, or any error occurs. */

import type { DocumentFormat } from "./types";

const MIME_TYPES: Record<DocumentFormat, string> = {
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
};

const SKILL_IDS: Record<DocumentFormat, string> = {
  pptx: "pptx-generation", docx: "docx-generation",
  xlsx: "xlsx-generation", pdf: "pdf-generation",
};

const MAX_PAUSE_ITERATIONS = 5;

export async function generateViaClaudeSkills(options: {
  prompt: string;
  format: DocumentFormat;
  model?: string;
}): Promise<{ buffer: Buffer; filename: string; mimeType: string } | null> {
  const { prompt, format, model } = options;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  console.log(`[ClaudeSkills] Using Claude Skills API for ${format}`);

  try {
    // Dynamic import so we don't crash if the SDK isn't installed
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey });

    let response = await client.messages.create({
      model: model ?? "claude-sonnet-4-20250514",
      max_tokens: 16384,
      betas: [
        "code-execution-2025-08-25",
        "skills-2025-10-02",
        "files-api-2025-04-14",
      ],
      messages: [
        {
          role: "user",
          content: `Generate a professional ${format.toUpperCase()} file. ${prompt}`,
        },
      ],
      container: {
        skills: [SKILL_IDS[format]],
      },
    } as any);

    // Handle pause_turn for long-running operations
    let iterations = 0;
    while (
      (response as any).stop_reason === "pause_turn" &&
      iterations < MAX_PAUSE_ITERATIONS
    ) {
      iterations++;
      console.log(
        `[ClaudeSkills] pause_turn iteration ${iterations}/${MAX_PAUSE_ITERATIONS}`
      );
      response = await client.messages.create({
        model: model ?? "claude-sonnet-4-20250514",
        max_tokens: 16384,
        betas: [
          "code-execution-2025-08-25",
          "skills-2025-10-02",
          "files-api-2025-04-14",
        ],
        messages: [
          {
            role: "user",
            content: `Generate a professional ${format.toUpperCase()} file. ${prompt}`,
          },
          { role: "assistant", content: response.content },
          { role: "user", content: "Please continue." },
        ],
        container: {
          skills: [SKILL_IDS[format]],
        },
      } as any);
    }

    // Extract file ID from response content blocks
    const fileBlock = response.content.find(
      (block: any) => block.type === "file" || block.type === "tool_result"
    ) as any;

    const fileId =
      fileBlock?.file_id ??
      fileBlock?.content?.find?.((c: any) => c.type === "file")?.file_id;

    if (!fileId) {
      console.warn("[ClaudeSkills] No file ID found in response");
      return null;
    }

    // Download file via Files API
    const fileResponse = await (client as any).files.content(fileId);
    const arrayBuffer = await fileResponse.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const filename = `document_${Date.now()}.${format}`;

    return {
      buffer,
      filename,
      mimeType: MIME_TYPES[format],
    };
  } catch (err: any) {
    console.warn(`[ClaudeSkills] Failed for ${format}: ${err?.message}`);
    return null;
  }
}
