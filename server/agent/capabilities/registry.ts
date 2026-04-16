// server/agent/capabilities/registry.ts
import { z } from 'zod';

export interface AgentCapability {
    name: string;
    description: string;
    schema: z.ZodSchema<any>;
    execute: (args: any) => Promise<any>;
}

export class CapabilityRegistry {
    private capabilities = new Map<string, AgentCapability>();

    register(cap: AgentCapability) {
        this.capabilities.set(cap.name, cap);
    }

    getToolSchemas() {
        // Converts zod to JSON Schema for OpenAI function calling
        return Array.from(this.capabilities.values()).map(c => ({
            name: c.name,
            description: c.description,
            parameters: "JSON_SCHEMA" // Placeholder
        }));
    }
}
import { webScraperCapability } from './browser/webScraper';
import { localFileSearchCapability, dockerOperatorCapability } from './system/osOps';
import { emailFetcherCapability } from './communication/email';

export const capabilityRegistry = new CapabilityRegistry();
capabilityRegistry.register(webScraperCapability);
capabilityRegistry.register(localFileSearchCapability);
capabilityRegistry.register(dockerOperatorCapability);
capabilityRegistry.register(emailFetcherCapability);
