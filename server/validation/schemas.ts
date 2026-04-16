/**
 * Request Validation Schemas
 * Zod schemas for validating API request bodies
 */

import { z } from "zod";

// ============= AUTH SCHEMAS =============

export const loginSchema = z.object({
  email: z.string().email("Invalid email format"),
  password: z.string().min(1, "Password is required"),
  rememberMe: z.boolean().optional().default(false)
});

export const registerSchema = z.object({
  email: z.string().email("Invalid email format"),
  password: z.string()
    .min(8, "Password must be at least 8 characters")
    .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
    .regex(/[0-9]/, "Password must contain at least one number"),
  fullName: z.string().min(2, "Name must be at least 2 characters").max(100),
  acceptTerms: z.literal(true, {
    errorMap: () => ({ message: "You must accept the terms and conditions" })
  })
});

export const resetPasswordSchema = z.object({
  email: z.string().email("Invalid email format")
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string()
    .min(8, "Password must be at least 8 characters")
    .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
    .regex(/[0-9]/, "Password must contain at least one number"),
  confirmPassword: z.string()
}).refine(data => data.newPassword === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"]
});

// ============= CHAT SCHEMAS =============

export const createChatSchema = z.object({
  title: z.string().max(200).optional(),
  model: z.string().optional(),
  systemPrompt: z.string().max(5000000).optional()
});

export const sendMessageSchema = z.object({
  content: z.string()
    .min(1, "Message cannot be empty")
    .max(5000000, "Message too long"),
  model: z.string().optional(),
  attachments: z.array(z.object({
    type: z.enum(["image", "file", "audio"]),
    url: z.string().url().optional(),
    base64: z.string().optional(),
    name: z.string().optional(),
    mimeType: z.string().optional()
  })).optional()
});

export const updateChatSchema = z.object({
  title: z.string().max(200).optional(),
  isPinned: z.boolean().optional(),
  isArchived: z.boolean().optional()
});

// ============= ADMIN SCHEMAS =============

export const updateUserSchema = z.object({
  fullName: z.string().min(2).max(100).optional(),
  email: z.string().email().optional(),
  role: z.enum(["user", "admin", "moderator"]).optional(),
  status: z.enum(["active", "blocked", "pending"]).optional(),
  plan: z.enum(["free", "pro", "enterprise"]).optional()
});

export const blockUserSchema = z.object({
  reason: z.string().max(500).optional()
});

export const createModelSchema = z.object({
  name: z.string().min(1).max(100),
  provider: z.string().min(1),
  modelId: z.string().min(1),
  costPer1k: z.number().min(0).optional(),
  description: z.string().max(500).optional(),
  status: z.enum(["active", "inactive", "deprecated"]).optional()
});

export const updateModelSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  status: z.enum(["active", "inactive", "deprecated"]).optional(),
  isEnabled: z.boolean().optional(),
  costPer1k: z.number().min(0).optional(),
  description: z.string().max(500).optional()
});

export const createSecurityPolicySchema = z.object({
  policyName: z.string().min(1).max(100),
  policyType: z.enum(["cors", "csp", "rate_limit", "ip_block", "ip_whitelist", "geo_block"]),
  rules: z.record(z.any()),
  priority: z.number().int().min(0).max(1000).optional(),
  appliedTo: z.string().optional(),
  isEnabled: z.boolean().optional()
});

export const blockIPSchema = z.object({
  ip: z.string().regex(/^(\d{1,3}\.){3}\d{1,3}$/, "Invalid IP address format"),
  reason: z.string().max(500).optional(),
  duration: z.string().optional()
});

// ============= SETTINGS SCHEMAS =============

export const updateSettingSchema = z.object({
  value: z.any()
});

export const bulkUpdateSettingsSchema = z.object({
  settings: z.array(z.object({
    key: z.string().min(1),
    value: z.any()
  }))
});

// ============= INVOICE SCHEMAS =============

export const createInvoiceSchema = z.object({
  invoiceNumber: z.string().min(1).max(50),
  amount: z.union([z.string(), z.number()]),
  userId: z.string().optional(),
  currency: z.string().default("USD"),
  dueDate: z.string().optional()
});

// ============= REPORT SCHEMAS =============

export const generateReportSchema = z.object({
  templateId: z.string().optional(),
  type: z.string(),
  filters: z.record(z.any()).optional(),
  format: z.enum(["json", "csv", "pdf"]).optional()
});

// ============= DATABASE SCHEMAS =============

export const executeQuerySchema = z.object({
  query: z.string()
    .min(1)
    .max(10000)
    // Block dangerous operations
    .refine(q => !/(DROP|TRUNCATE|DELETE\s+FROM\s+\w+\s*$|ALTER\s+TABLE.*DROP)/i.test(q), {
      message: "This query type is not allowed"
    })
});

// ============= HELPER FUNCTIONS =============

/**
 * Validate request body against schema
 */
export function validateBody<T>(schema: z.ZodSchema<T>, body: unknown): {
  success: boolean;
  data?: T;
  errors?: z.ZodError
} {
  const result = schema.safeParse(body);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, errors: result.error };
}

/**
 * Express middleware for validation
 */
export function validate<T>(schema: z.ZodSchema<T>) {
  return (req: any, res: any, next: any) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        error: "Validation failed",
        details: result.error.errors.map(e => ({
          field: e.path.join('.'),
          message: e.message
        }))
      });
    }
    req.validatedBody = result.data;
    next();
  };
}

/**
 * Sanitize HTML from string
 */
export function sanitizeHtml(input: string): string {
  return input
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+=/gi, '');
}

/**
 * Sanitize for SQL (basic - use parameterized queries instead)
 */
export function sanitizeSql(input: string): string {
  return input.replace(/['";\\]/g, '\\$&');
}

// Export types
export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type SendMessageInput = z.infer<typeof sendMessageSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type CreateModelInput = z.infer<typeof createModelSchema>;
export type CreateSecurityPolicyInput = z.infer<typeof createSecurityPolicySchema>;
export type ExecuteQueryInput = z.infer<typeof executeQuerySchema>;
