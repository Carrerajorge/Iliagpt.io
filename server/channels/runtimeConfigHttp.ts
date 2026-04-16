import { z } from "zod";
import { resolveRuntimeConfig, channelRuntimeConfigSchema } from "./runtimeConfig";

export const runtimeSettingsUpdateSchema = channelRuntimeConfigSchema.strict();

export const runtimeSettingsQuerySchema = z.object({
  channelKey: z.string().optional(),
}).optional();

export function withRuntimeSettingsMetadata(existingMetadata: any, runtimePatch: Record<string, unknown>) {
  const metadata = (existingMetadata && typeof existingMetadata === "object") ? existingMetadata : {};
  return {
    ...metadata,
    runtime: {
      ...(metadata as any).runtime,
      ...runtimePatch,
    },
  };
}

export function extractRuntimeSettings(metadata: any) {
  return resolveRuntimeConfig(metadata);
}
