import { z } from "zod";

export const CodexAgentRoleSchema = z.enum(["coder", "reviewer", "improver"]);
export type CodexAgentRole = z.infer<typeof CodexAgentRoleSchema>;

export const WorkspaceContextSchema = z
  .object({
    projectId: z.string().max(200).optional(),
    projectName: z.string().max(200).optional(),
    repositoryPath: z.string().trim().min(1).max(1024),
    selectedFolder: z.string().trim().min(1).max(512).optional(),
    codingAgents: z.array(CodexAgentRoleSchema).max(8).optional(),
    runtimeTarget: z.string().max(80).optional(),
    executionAccess: z.string().max(80).optional(),
    branch: z.string().max(120).optional(),
  })
  .strict();

export type WorkspaceContext = z.infer<typeof WorkspaceContextSchema>;
