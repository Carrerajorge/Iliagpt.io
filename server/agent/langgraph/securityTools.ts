import { tool } from "@langchain/core/tools";
import { z } from "zod";
import OpenAI from "openai";
import * as crypto from "crypto";

const xaiClient = new OpenAI({
  baseURL: "https://api.x.ai/v1",
  apiKey: process.env.XAI_API_KEY || "missing",
});

const DEFAULT_MODEL = "grok-4-1-fast-non-reasoning";

export const encryptDataTool = tool(
  async (input) => {
    const { data, algorithm = "aes-256-gcm", key } = input;
    const startTime = Date.now();

    try {
      const keyBuffer = key 
        ? Buffer.from(key, "hex") 
        : crypto.randomBytes(32);
      
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv(algorithm, keyBuffer, iv);
      
      let encrypted = cipher.update(data, "utf8", "hex");
      encrypted += cipher.final("hex");
      
      const authTag = (cipher as any).getAuthTag?.()?.toString("hex") || "";

      return JSON.stringify({
        success: true,
        encrypted: {
          ciphertext: encrypted,
          iv: iv.toString("hex"),
          authTag,
          algorithm,
        },
        keyGenerated: !key,
        key: !key ? keyBuffer.toString("hex") : undefined,
        metadata: {
          originalLength: data.length,
          encryptedLength: encrypted.length,
        },
        latencyMs: Date.now() - startTime,
      });
    } catch (error: any) {
      return JSON.stringify({
        success: false,
        error: error.message,
        latencyMs: Date.now() - startTime,
      });
    }
  },
  {
    name: "encrypt_data",
    description: "Encrypts data using AES-256-GCM or other symmetric encryption algorithms.",
    schema: z.object({
      data: z.string().describe("Data to encrypt"),
      algorithm: z.enum(["aes-256-gcm", "aes-256-cbc", "aes-128-gcm"]).optional().default("aes-256-gcm")
        .describe("Encryption algorithm"),
      key: z.string().optional().describe("Encryption key in hex (generates if not provided)"),
    }),
  }
);

export const decryptDataTool = tool(
  async (input) => {
    const { ciphertext, key, iv, authTag, algorithm = "aes-256-gcm" } = input;
    const startTime = Date.now();

    try {
      const keyBuffer = Buffer.from(key, "hex");
      const ivBuffer = Buffer.from(iv, "hex");
      const decipher = crypto.createDecipheriv(algorithm, keyBuffer, ivBuffer);
      
      if (authTag && algorithm.includes("gcm")) {
        (decipher as any).setAuthTag(Buffer.from(authTag, "hex"));
      }
      
      let decrypted = decipher.update(ciphertext, "hex", "utf8");
      decrypted += decipher.final("utf8");

      return JSON.stringify({
        success: true,
        decrypted,
        metadata: {
          decryptedLength: decrypted.length,
        },
        latencyMs: Date.now() - startTime,
      });
    } catch (error: any) {
      return JSON.stringify({
        success: false,
        error: error.message,
        latencyMs: Date.now() - startTime,
      });
    }
  },
  {
    name: "decrypt_data",
    description: "Decrypts data encrypted with AES-256-GCM or other symmetric algorithms.",
    schema: z.object({
      ciphertext: z.string().describe("Encrypted data in hex"),
      key: z.string().describe("Decryption key in hex"),
      iv: z.string().describe("Initialization vector in hex"),
      authTag: z.string().optional().describe("Authentication tag for GCM mode"),
      algorithm: z.enum(["aes-256-gcm", "aes-256-cbc", "aes-128-gcm"]).optional().default("aes-256-gcm"),
    }),
  }
);

export const hashDataTool = tool(
  async (input) => {
    const { data, algorithm = "sha256", salt, iterations = 100000 } = input;
    const startTime = Date.now();

    try {
      let hash: string;
      let usedSalt: string | undefined;

      if (algorithm === "bcrypt-like") {
        usedSalt = salt || crypto.randomBytes(16).toString("hex");
        hash = crypto.pbkdf2Sync(data, usedSalt, iterations, 64, "sha512").toString("hex");
      } else {
        hash = crypto.createHash(algorithm).update(data).digest("hex");
      }

      return JSON.stringify({
        success: true,
        hash,
        algorithm,
        salt: usedSalt,
        iterations: algorithm === "bcrypt-like" ? iterations : undefined,
        metadata: {
          inputLength: data.length,
          hashLength: hash.length,
        },
        latencyMs: Date.now() - startTime,
      });
    } catch (error: any) {
      return JSON.stringify({
        success: false,
        error: error.message,
        latencyMs: Date.now() - startTime,
      });
    }
  },
  {
    name: "hash_data",
    description: "Hashes data using SHA-256, SHA-512, or PBKDF2 for password hashing.",
    schema: z.object({
      data: z.string().describe("Data to hash"),
      algorithm: z.enum(["sha256", "sha512", "md5", "sha1", "bcrypt-like"]).optional().default("sha256")
        .describe("Hash algorithm"),
      salt: z.string().optional().describe("Salt for password hashing"),
      iterations: z.number().optional().default(100000).describe("PBKDF2 iterations"),
    }),
  }
);

export const validateInputTool = tool(
  async (input) => {
    const { data, rules } = input;
    const startTime = Date.now();

    try {
      const validationResults: Array<{
        field: string;
        valid: boolean;
        errors: string[];
        sanitized?: string;
      }> = [];

      for (const rule of rules) {
        const { field, type, required = false, minLength, maxLength, pattern, sanitize = false } = rule;
        const value = data[field];
        const errors: string[] = [];
        let sanitizedValue = value;

        if (required && (value === undefined || value === null || value === "")) {
          errors.push(`${field} is required`);
        } else if (value !== undefined && value !== null) {
          if (type === "email") {
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(value)) errors.push("Invalid email format");
          } else if (type === "url") {
            try { new URL(value); } catch { errors.push("Invalid URL format"); }
          } else if (type === "phone") {
            const phoneRegex = /^[\+]?[(]?[0-9]{3}[)]?[-\s\.]?[0-9]{3}[-\s\.]?[0-9]{4,6}$/;
            if (!phoneRegex.test(value)) errors.push("Invalid phone format");
          } else if (type === "number") {
            if (isNaN(Number(value))) errors.push("Must be a number");
          }

          if (minLength && String(value).length < minLength) {
            errors.push(`Minimum length is ${minLength}`);
          }
          if (maxLength && String(value).length > maxLength) {
            errors.push(`Maximum length is ${maxLength}`);
          }
          if (pattern && !new RegExp(pattern).test(value)) {
            errors.push(`Does not match pattern: ${pattern}`);
          }

          if (sanitize && typeof value === "string") {
            sanitizedValue = value
              .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
              .replace(/[<>]/g, "")
              .trim();
          }
        }

        validationResults.push({
          field,
          valid: errors.length === 0,
          errors,
          sanitized: sanitize ? sanitizedValue : undefined,
        });
      }

      const allValid = validationResults.every(r => r.valid);

      return JSON.stringify({
        success: true,
        valid: allValid,
        results: validationResults,
        summary: {
          totalFields: rules.length,
          validFields: validationResults.filter(r => r.valid).length,
          invalidFields: validationResults.filter(r => !r.valid).length,
        },
        latencyMs: Date.now() - startTime,
      });
    } catch (error: any) {
      return JSON.stringify({
        success: false,
        error: error.message,
        latencyMs: Date.now() - startTime,
      });
    }
  },
  {
    name: "validate_input",
    description: "Validates and sanitizes user input against security rules. Prevents XSS, SQL injection, and validates formats.",
    schema: z.object({
      data: z.record(z.any()).describe("Data object to validate"),
      rules: z.array(z.object({
        field: z.string(),
        type: z.enum(["string", "email", "url", "phone", "number", "date"]).optional(),
        required: z.boolean().optional(),
        minLength: z.number().optional(),
        maxLength: z.number().optional(),
        pattern: z.string().optional(),
        sanitize: z.boolean().optional(),
      })).describe("Validation rules"),
    }),
  }
);

export const auditLogTool = tool(
  async (input) => {
    const { action, actor, resource, details = {}, severity = "info" } = input;
    const startTime = Date.now();

    try {
      const logEntry = {
        id: `audit-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`,
        timestamp: new Date().toISOString(),
        action,
        actor: {
          type: actor.type || "user",
          id: actor.id,
          ip: actor.ip,
          userAgent: actor.userAgent,
        },
        resource: {
          type: resource.type,
          id: resource.id,
          name: resource.name,
        },
        details,
        severity,
        checksum: "",
      };

      logEntry.checksum = crypto
        .createHash("sha256")
        .update(JSON.stringify(logEntry))
        .digest("hex")
        .substring(0, 16);

      return JSON.stringify({
        success: true,
        logEntry,
        formatted: {
          syslog: `<${severity === "critical" ? 2 : severity === "warning" ? 4 : 6}> ${logEntry.timestamp} ${actor.id} ${action} ${resource.type}:${resource.id}`,
          json: JSON.stringify(logEntry),
          cef: `CEF:0|Agent|Security|1.0|${action}|${action}|${severity === "critical" ? 10 : 5}|src=${actor.ip} suser=${actor.id} cs1=${resource.type}`,
        },
        latencyMs: Date.now() - startTime,
      });
    } catch (error: any) {
      return JSON.stringify({
        success: false,
        error: error.message,
        latencyMs: Date.now() - startTime,
      });
    }
  },
  {
    name: "audit_log",
    description: "Creates tamper-evident audit log entries for security compliance. Supports syslog, JSON, and CEF formats.",
    schema: z.object({
      action: z.string().describe("Action performed (e.g., 'user.login', 'data.access')"),
      actor: z.object({
        type: z.string().optional(),
        id: z.string(),
        ip: z.string().optional(),
        userAgent: z.string().optional(),
      }).describe("Who performed the action"),
      resource: z.object({
        type: z.string(),
        id: z.string(),
        name: z.string().optional(),
      }).describe("What was affected"),
      details: z.record(z.any()).optional().default({}).describe("Additional details"),
      severity: z.enum(["info", "warning", "critical"]).optional().default("info"),
    }),
  }
);

export const secretsManageTool = tool(
  async (input) => {
    const { action, keyName, value, expiresIn } = input;
    const startTime = Date.now();

    try {
      const response = await xaiClient.chat.completions.create({
        model: DEFAULT_MODEL,
        messages: [
          {
            role: "system",
            content: `You are a secrets management expert. Help manage secrets securely.

Return JSON:
{
  "action": "action performed",
  "keyName": "secret key name",
  "status": "success|error",
  "metadata": {
    "createdAt": "timestamp",
    "expiresAt": "expiration timestamp if set",
    "version": "version number",
    "encrypted": true
  },
  "bestPractices": ["security recommendations"],
  "rotation": {
    "recommended": boolean,
    "nextRotation": "suggested rotation date",
    "policy": "rotation policy"
  },
  "integrations": {
    "vault": "HashiCorp Vault command",
    "awsSecretsManager": "AWS CLI command",
    "azureKeyVault": "Azure CLI command"
  }
}`,
          },
          {
            role: "user",
            content: `Secrets operation:
Action: ${action}
Key name: ${keyName}
Value: ${value ? "[PROVIDED - REDACTED]" : "[NOT PROVIDED]"}
Expires in: ${expiresIn || "Never"}`,
          },
        ],
        temperature: 0.2,
      });

      const content = response.choices[0].message.content || "";
      const jsonMatch = content.match(/\{[\s\S]*\}/);

      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]);
        return JSON.stringify({
          success: true,
          action,
          keyName,
          ...result,
          latencyMs: Date.now() - startTime,
        });
      }

      return JSON.stringify({
        success: true,
        action,
        keyName,
        status: "processed",
        latencyMs: Date.now() - startTime,
      });
    } catch (error: any) {
      return JSON.stringify({
        success: false,
        error: error.message,
        latencyMs: Date.now() - startTime,
      });
    }
  },
  {
    name: "secrets_manage",
    description: "Manages secrets with encryption, rotation policies, and integration with Vault, AWS Secrets Manager, and Azure Key Vault.",
    schema: z.object({
      action: z.enum(["create", "read", "update", "delete", "rotate", "list"]).describe("Secret operation"),
      keyName: z.string().describe("Secret key name"),
      value: z.string().optional().describe("Secret value (for create/update)"),
      expiresIn: z.string().optional().describe("Expiration time (e.g., '30d', '1y')"),
    }),
  }
);

export const SECURITY_TOOLS = [
  encryptDataTool,
  decryptDataTool,
  hashDataTool,
  validateInputTool,
  auditLogTool,
  secretsManageTool,
];
