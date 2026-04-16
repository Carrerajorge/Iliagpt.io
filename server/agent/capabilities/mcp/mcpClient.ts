import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { z } from 'zod';
import { AgentCapability } from '../registry';

export class MCPDynamicLoader {
    private client: Client;

    constructor() {
        this.client = new Client(
            {
                name: "michat-superintelligence-brain",
                version: "1.0.0",
            },
            {
                capabilities: {}
            }
        );
    }

    /**
     * Conecta a un servidor MCP local a través de Stdio (Child Process)
     */
    async connectStdio(command: string, args: string[], env?: Record<string, string>): Promise<void> {
        console.log(`[MCP Loader] Connecting to Stdio server: ${command} ${args.join(' ')}`);

        const procEnv = process.env as Record<string, string>;
        const transport = new StdioClientTransport({
            command,
            args,
            env: { ...procEnv, ...env }
        });

        await this.client.connect(transport);
        console.log(`[MCP Loader] Connected successfully to ${command}`);
    }

    /**
     * Interroga al Servidor MCP por sus Tools y las convierte al formato AgentCapability de LangChain/MCTS
     */
    async fetchCapabilities(): Promise<AgentCapability[]> {
        console.log(`[MCP Loader] Fetching tools from connected server...`);
        const response = await this.client.listTools();

        const capabilities: AgentCapability[] = [];

        for (const tool of response.tools) {

            // Convertimos la especificacion JSON Schema nativa de MCP a un Zod basico para el LLM.
            // Para casos más complejos (anidamiento), se puede usar zod-to-json-schema invertido o Any.
            // Aquí usamos un approach genérico que permite inyectar el params directamente al transporte
            const dynamicSchema = z.any().describe(
                `MCP Tool: ${tool.name}. Parametros requeridos según JSON Schema original: ${JSON.stringify(tool.inputSchema)}`
            );

            capabilities.push({
                name: `mcp_${tool.name}`, // Prefijamos para evitar colisiones globales
                description: tool.description || `Dynamic MCP Tool mapped from attached server.`,
                schema: dynamicSchema,
                execute: async (args: any) => {
                    console.log(`[MCP Router] Executing Tool: ${tool.name} with payload`, args);

                    try {
                        const callResult = await this.client.callTool({
                            name: tool.name,
                            arguments: args
                        });

                        // MCP retorna Content arrays (Text, Image, etc)
                        // Aplanamos a Strings para consumo del Cerebro MCTS
                        if (callResult.isError) {
                            return { error: true, details: callResult.content };
                        }

                        // MCP 1.0 Client Content Types are Array<{ type: string; text?: string; ... }>
                        const contents = callResult.content as Array<any>;
                        return {
                            success: true,
                            content: contents.map((c: any) => c.text ? c.text : '[Media Resource]').join('\n')
                        };

                    } catch (e: any) {
                        return {
                            success: false,
                            error: `MCP Transport failure: ${e.message}`
                        };
                    }
                }
            });
        }

        console.log(`[MCP Loader] Successfully mapped ${capabilities.length} dynamic capabilities!`);
        return capabilities;
    }

    /**
     * Disconnects the underlying transport
     */
    async close() {
        await this.client.close();
    }
}
