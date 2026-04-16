/**
 * Agent capability that exposes the Office Engine to the LLM tool-use loop.
 *
 * The capability is intentionally a thin wrapper: it accepts a base64-encoded
 * input buffer (or none, for create-from-spec runs), an objective string, and
 * returns the run id + final artifact metadata. The full step timeline is
 * persisted to the database and exposed via the SSE endpoint, so the agent
 * doesn't need to stream them through this return value.
 */

import { z } from "zod";
import type { AgentCapability } from "../registry";
import { StepStreamer } from "../../stepStreamer";
import { officeEngine } from "../../../lib/office/engine/OfficeEngine";

export const officeEngineEditDocxCapability: AgentCapability = {
  name: "office_engine_edit_docx",
  description:
    "Run the production-grade Office Engine pipeline on a DOCX file: unpack, parse, build a semantic map, edit (with fallback ladder: docx → docxtemplater → OOXML node-by-node), validate, repack, round-trip diff, preview, and export. Use this tool whenever you need to safely modify a Word document while preserving namespaces, styles, lists, tables, headers/footers, hyperlinks, and Unicode.",
  schema: z.object({
    objective: z
      .string()
      .min(3)
      .describe(
        "Natural-language description of the edit (e.g. 'replace \"hola\" with \"adiós\"', 'fill placeholders {{name}}={{value}}', 'create a document about X')",
      ),
    inputBase64: z
      .string()
      .optional()
      .describe("Base64-encoded DOCX file to edit. Omit for 'create from spec' runs."),
    inputName: z.string().optional().describe("Original filename, used for the exported file naming"),
    conversationId: z.string().optional(),
  }),
  execute: async ({ objective, inputBase64, inputName, conversationId }) => {
    const inputBuffer = inputBase64 ? Buffer.from(inputBase64, "base64") : undefined;
    const streamer = new StepStreamer();
    const result = await officeEngine.run(
      {
        userId: "agent",
        conversationId: conversationId ?? null,
        objective,
        docKind: "docx",
        inputName,
        inputBuffer,
      },
      streamer,
    );
    return {
      run_id: result.runId,
      status: result.status,
      fallback_level: result.fallbackLevel,
      duration_ms: result.durationMs,
      artifacts: result.artifacts,
      steps: streamer.getSteps().map((s) => ({
        type: s.type,
        title: s.title,
        status: s.status,
        duration_ms: s.duration,
      })),
      error: result.error,
    };
  },
};
