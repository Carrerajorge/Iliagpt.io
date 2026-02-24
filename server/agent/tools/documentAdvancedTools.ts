/**
 * Document Advanced Tools Registration
 * Tools for document tagging, classification, and digital signatures.
 */

import { z } from "zod";
import { autoTagDocument, classifyDocument, suggestRelatedTags } from "../../services/documentTagging";
import { signDocument, verifyByHash, listSignedDocuments, hashDocument } from "../../services/digitalSignature";

export interface ToolDefinition {
  name: string;
  description: string;
  category: string;
  schema: z.ZodObject<any>;
  execute: (params: any) => Promise<any>;
}

export const documentAdvancedTools: ToolDefinition[] = [
  {
    name: "document_auto_tag",
    description: "Auto-tag a document using AI analysis",
    category: "document",
    schema: z.object({
      content: z.string().min(50),
      filename: z.string().optional(),
    }),
    execute: async (params) => autoTagDocument(params.content, params.filename),
  },
  {
    name: "document_classify",
    description: "Classify a document into academic/professional categories",
    category: "document",
    schema: z.object({
      content: z.string().min(50),
      filename: z.string().optional(),
    }),
    execute: async (params) => classifyDocument(params.content, params.filename),
  },
  {
    name: "document_suggest_tags",
    description: "Suggest related tags based on existing tags",
    category: "document",
    schema: z.object({
      tags: z.array(z.string()).min(1),
    }),
    execute: async (params) => ({
      suggestions: suggestRelatedTags(params.tags),
    }),
  },
  {
    name: "document_sign",
    description: "Digitally sign a document file",
    category: "document",
    schema: z.object({
      filePath: z.string(),
      signer: z.string(),
    }),
    execute: async (params) => signDocument(params.filePath, params.signer),
  },
  {
    name: "document_verify_signature",
    description: "Verify a document's digital signature",
    category: "document",
    schema: z.object({
      filePath: z.string(),
    }),
    execute: async (params) => verifyByHash(params.filePath),
  },
  {
    name: "document_hash",
    description: "Generate SHA-256 hash of a document",
    category: "document",
    schema: z.object({
      filePath: z.string(),
    }),
    execute: async (params) => ({
      hash: await hashDocument(params.filePath),
      algorithm: "sha256",
    }),
  },
  {
    name: "document_list_signed",
    description: "List all digitally signed documents",
    category: "document",
    schema: z.object({}),
    execute: async () => ({
      documents: await listSignedDocuments(),
    }),
  },
];
