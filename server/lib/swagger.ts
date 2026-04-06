import { OpenApiGeneratorV3, OpenAPIRegistry, extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";

import { chatRequestSchema, streamChatRequestSchema } from "../schemas/chatSchemas";
import { createInvoiceSchema } from "../validation/schemas";

extendZodWithOpenApi(z);

const registry = new OpenAPIRegistry();

const ErrorSchema = registry.register(
  "Error",
  z.object({
    error: z.string(),
    code: z.string().optional(),
    message: z.string().optional(),
    details: z.any().optional(),
  }),
);

const UserSchema = registry.register(
  "User",
  z.object({
    id: z.string(),
    username: z.string().optional(),
    email: z.string().email(),
    role: z.enum(["user", "admin"]),
  }),
);

const ChatRequestSchema = registry.register("ChatRequest", chatRequestSchema);
const StreamChatRequestSchema = registry.register("StreamChatRequest", streamChatRequestSchema);
const CreateInvoiceRequestSchema = registry.register("CreateInvoiceRequest", createInvoiceSchema);
const InvoiceSchema = registry.register(
  "Invoice",
  z.object({
    id: z.string(),
    userId: z.string().nullable().optional(),
    paymentId: z.string().nullable().optional(),
    source: z.string().nullable().optional(),
    invoiceNumber: z.string(),
    amount: z.string(),
    amountValue: z.union([z.string(), z.number()]).nullable().optional(),
    amountMinor: z.number().nullable().optional(),
    currency: z.string().nullable().optional(),
    status: z.string().nullable().optional(),
    dueDate: z.string().nullable().optional(),
    paidAt: z.string().nullable().optional(),
    createdAt: z.string().nullable().optional(),
  }),
);

registry.registerPath({
  method: "post",
  path: "/chat",
  tags: ["Chat"],
  summary: "Non-streaming chat completion",
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: ChatRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Chat response",
      content: {
        "application/json": {
          schema: z.object({
            response: z.string().optional(),
            conversationId: z.string().optional(),
          }).passthrough(),
        },
      },
    },
    400: {
      description: "Invalid request",
      content: {
        "application/json": {
          schema: ErrorSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/chat/stream",
  tags: ["Chat"],
  summary: "Streaming chat completion over SSE",
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: StreamChatRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Server-Sent Events stream",
      content: {
        "text/event-stream": {
          schema: z.string(),
        },
      },
    },
    400: {
      description: "Invalid request",
      content: {
        "application/json": {
          schema: ErrorSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/health/live",
  tags: ["Health"],
  summary: "Kubernetes liveness probe",
  responses: {
    200: {
      description: "Process is alive",
      content: {
        "application/json": {
          schema: z.object({
            alive: z.boolean(),
            pid: z.number(),
            uptime: z.number(),
            timestamp: z.string(),
          }),
        },
      },
    },
    503: {
      description: "Process alive but unhealthy due to memory pressure",
      content: {
        "application/json": {
          schema: ErrorSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/admin/finance/invoices",
  tags: ["Admin Finance"],
  summary: "Create invoice",
  security: [{ cookieAuth: [] }],
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: CreateInvoiceRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Created invoice",
      content: {
        "application/json": {
          schema: InvoiceSchema,
        },
      },
    },
    400: {
      description: "Invalid request",
      content: {
        "application/json": {
          schema: ErrorSchema,
        },
      },
    },
    401: {
      description: "Unauthorized",
      content: {
        "application/json": {
          schema: ErrorSchema,
        },
      },
    },
  },
});

const generator = new OpenApiGeneratorV3(registry.definitions);

export const swaggerSpec = generator.generateDocument({
  openapi: "3.0.0",
  info: {
    title: "ILIAGPT PRO API",
    version: "1.0.0",
    description: "API documentation for ILIAGPT PRO 3.0",
    contact: {
      name: "API Support",
      email: "support@iliagpt.com",
    },
  },
  servers: [
    {
      url: "/api",
      description: "Main API Server",
    },
  ],
  tags: [
    { name: "Chat" },
    { name: "Health" },
    { name: "Admin Finance" },
  ],
  components: {
    securitySchemes: {
      cookieAuth: {
        type: "apiKey",
        in: "cookie",
        name: "connect.sid",
      },
    },
  },
  security: [
    {
      cookieAuth: [],
    },
  ],
});

swaggerSpec.components = {
  ...(swaggerSpec.components || {}),
  securitySchemes: {
    cookieAuth: {
      type: "apiKey",
      in: "cookie",
      name: "connect.sid",
    },
  },
};

export const registeredOpenApiSchemas = {
  ErrorSchema,
  UserSchema,
  ChatRequestSchema,
  StreamChatRequestSchema,
  CreateInvoiceRequestSchema,
  InvoiceSchema,
};
