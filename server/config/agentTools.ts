export interface FunctionDeclaration {
    name: string;
    description: string;
    parameters: {
        type: string;
        properties: Record<string, any>;
        required?: string[];
    };
}

export const AGENT_TOOLS: FunctionDeclaration[] = [
    {
        name: "web_search",
        description: "Search the web for current information on any topic",
        parameters: {
            type: "object",
            properties: {
                query: { type: "string", description: "The search query" },
                maxResults: { type: "number", description: "Maximum results (default 5)" }
            },
            required: ["query"]
        }
    },
    {
        name: "fetch_url",
        description: "Fetch and extract text content from a URL",
        parameters: {
            type: "object",
            properties: {
                url: { type: "string", description: "URL to fetch" },
                extractText: { type: "boolean", description: "Extract readable text (default true)" }
            },
            required: ["url"]
        }
    },
    {
        name: "browse_and_act",
        description: "Open a real browser and autonomously accomplish a goal: navigate websites, fill forms, click buttons, make reservations, purchases, etc. Use this when you need to INTERACT with a website (not just read it). The browser uses AI vision to analyze pages and decide actions automatically.",
        parameters: {
            type: "object",
            properties: {
                url: { type: "string", description: "Starting URL to navigate to (e.g., https://www.mesa247.pe)" },
                goal: { type: "string", description: "Detailed description of what to accomplish (e.g., 'Make a reservation for 2 people on February 15, 2026 at 8:00 PM at a restaurant in Lima')" },
                maxSteps: { type: "number", description: "Maximum browser actions to take (default 20)" }
            },
            required: ["url", "goal"]
        }
    },
    {
        name: "create_presentation",
        description: "Create a PowerPoint presentation with slides",
        parameters: {
            type: "object",
            properties: {
                title: { type: "string", description: "Presentation title" },
                slides: {
                    type: "array",
                    items: {
                        type: "object",
                        properties: {
                            title: { type: "string" },
                            content: { type: "string" },
                            bullets: { type: "array", items: { type: "string" } },
                            layout: { type: "string", enum: ["title", "content", "twoColumn", "imageLeft", "imageRight"] }
                        }
                    },
                    description: "Array of slide definitions"
                },
                theme: { type: "string", description: "Theme name (default 'professional')" }
            },
            required: ["title", "slides"]
        }
    },
    {
        name: "create_document",
        description: "Create a Word document with sections and content",
        parameters: {
            type: "object",
            properties: {
                title: { type: "string", description: "Document title" },
                sections: {
                    type: "array",
                    items: {
                        type: "object",
                        properties: {
                            heading: { type: "string" },
                            content: { type: "string" },
                            bullets: { type: "array", items: { type: "string" } },
                            level: { type: "number" }
                        }
                    },
                    description: "Document sections"
                }
            },
            required: ["title", "sections"]
        }
    },
    {
        name: "create_spreadsheet",
        description: "Create an Excel spreadsheet with data",
        parameters: {
            type: "object",
            properties: {
                title: { type: "string", description: "Spreadsheet title" },
                sheets: {
                    type: "array",
                    items: {
                        type: "object",
                        properties: {
                            name: { type: "string" },
                            headers: { type: "array", items: { type: "string" } },
                            rows: { type: "array", items: { type: "array" } }
                        }
                    },
                    description: "Sheet definitions"
                }
            },
            required: ["title", "sheets"]
        }
    },
    {
        name: "analyze_data",
        description: "Analyze data and provide statistical insights",
        parameters: {
            type: "object",
            properties: {
                data: { type: "string", description: "Data to analyze (JSON, CSV, or description)" },
                analysisType: { type: "string", enum: ["summary", "trends", "comparison", "forecast"] }
            },
            required: ["data"]
        }
    },
    {
        name: "generate_chart",
        description: "Generate a chart visualization",
        parameters: {
            type: "object",
            properties: {
                chartType: { type: "string", enum: ["bar", "line", "pie", "scatter", "area"] },
                title: { type: "string" },
                data: { type: "object", description: "Chart data with labels and values" }
            },
            required: ["chartType", "data"]
        }
    },
    {
        name: "list_files",
        description: "List files and directories from workspace or local home directory. Use this for folder/computer analysis tasks.",
        parameters: {
            type: "object",
            properties: {
                directory: { type: "string", description: "Directory path. Use '~' for home or '~/Desktop' for Desktop." },
                maxEntries: { type: "number", description: "Maximum entries to return (default 200)." }
            }
        }
    },
    {
        name: "read_file",
        description: "Read a text file from workspace or local home directory.",
        parameters: {
            type: "object",
            properties: {
                filepath: { type: "string", description: "Path to the file to read." }
            },
            required: ["filepath"]
        }
    },
    {
        name: "memory_search",
        description: "Search semantic memory from prior sessions and context.",
        parameters: {
            type: "object",
            properties: {
                query: { type: "string", description: "Search query for memory retrieval." },
                limit: { type: "number", description: "Maximum results (1-20)." },
                hybridSearch: { type: "boolean", description: "Use semantic + keyword hybrid search." }
            },
            required: ["query"]
        }
    },
    {
        name: "openclaw_rag_search",
        description: "Run native OpenClaw/Clawi RAG search over user memory/context.",
        parameters: {
            type: "object",
            properties: {
                query: { type: "string", description: "Search query." },
                limit: { type: "number", description: "Maximum results (1-20)." },
                minScore: { type: "number", description: "Minimum semantic score (0-1)." },
                chatId: { type: "string", description: "Optional chat scope filter." }
            },
            required: ["query"]
        }
    },
    {
        name: "openclaw_spawn_subagent",
        description: "Spawn a delegated subagent for parallel/background execution.",
        parameters: {
            type: "object",
            properties: {
                objective: { type: "string", description: "Objective for the subagent." },
                planHint: { type: "array", items: { type: "string" }, description: "Optional execution hints." },
                parentRunId: { type: "string", description: "Optional parent run id." }
            },
            required: ["objective"]
        }
    },
    {
        name: "openclaw_subagent_status",
        description: "Get the current status/result of a subagent run.",
        parameters: {
            type: "object",
            properties: {
                runId: { type: "string", description: "Subagent run identifier." }
            },
            required: ["runId"]
        }
    },
    {
        name: "openclaw_subagent_list",
        description: "List recent subagent runs for this user.",
        parameters: {
            type: "object",
            properties: {
                parentRunId: { type: "string", description: "Optional parent run filter." },
                status: { type: "string", description: "Optional status filter." },
                limit: { type: "number", description: "Maximum items to return." }
            }
        }
    },
    {
        name: "openclaw_subagent_cancel",
        description: "Cancel an in-flight subagent run.",
        parameters: {
            type: "object",
            properties: {
                runId: { type: "string", description: "Subagent run identifier." }
            },
            required: ["runId"]
        }
    },
    {
        name: "openclaw_clawi_status",
        description: "Inspect local Clawi/OpenClaw fusion status and capability catalog.",
        parameters: {
            type: "object",
            properties: {}
        }
    },
    {
        name: "openclaw_clawi_exec",
        description: "Execute native Clawi/OpenClaw CLI commands locally (no external API).",
        parameters: {
            type: "object",
            properties: {
                args: { type: "array", items: { type: "string" }, description: "CLI args, e.g. ['--help'] or ['agent','--mode','rpc']." },
                timeoutMs: { type: "number", description: "Timeout in milliseconds." }
            },
            required: ["args"]
        }
    }
];
