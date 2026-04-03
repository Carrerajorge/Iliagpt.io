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
                file_path: { type: "string", description: "Path to the file to read." },
                offset: { type: "number", description: "Line offset to start reading from (0-indexed)." },
                limit: { type: "number", description: "Maximum number of lines to read." }
            },
            required: ["file_path"]
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
        description: "Search user documents, memory, and conversation history using hybrid RAG (semantic + keyword). Returns relevant text fragments with similarity scores.",
        parameters: {
            type: "object",
            properties: {
                query: { type: "string", description: "Search query for document/memory retrieval." },
                limit: { type: "number", description: "Maximum results (1-20)." },
                minScore: { type: "number", description: "Minimum semantic score (0-1)." },
                chatId: { type: "string", description: "Optional chat scope filter." }
            },
            required: ["query"]
        }
    },
    {
        name: "rag_index_document",
        description: "Index a document into the RAG knowledge base for future semantic retrieval. Automatically chunks the document and creates searchable embeddings. Use this when the user uploads or provides a document to remember.",
        parameters: {
            type: "object",
            properties: {
                content: { type: "string", description: "Full text content of the document to index." },
                fileName: { type: "string", description: "Name of the document file." },
                fileType: { type: "string", description: "Type of document (pdf, docx, txt, etc.)." },
                sourceUrl: { type: "string", description: "Source URL if the document was fetched from the web." }
            },
            required: ["content"]
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
        name: "bash",
        description: "Execute a shell command and return stdout/stderr. Use for system operations, installing packages, running scripts, git commands, etc.",
        parameters: {
            type: "object",
            properties: {
                command: { type: "string", description: "The shell command to execute" },
                timeout: { type: "number", description: "Timeout in seconds (default 30, max 120)" }
            },
            required: ["command"]
        }
    },
    {
        name: "write_file",
        description: "Create or overwrite a file with the given content. Creates parent directories automatically.",
        parameters: {
            type: "object",
            properties: {
                file_path: { type: "string", description: "Path to the file to create/overwrite" },
                content: { type: "string", description: "Content to write to the file" }
            },
            required: ["file_path", "content"]
        }
    },
    {
        name: "edit_file",
        description: "Make a precise text replacement in a file. Finds the exact old_string and replaces it with new_string. For targeted edits without rewriting the entire file. If old_string is not found, the edit fails — use read_file first to see the exact content.",
        parameters: {
            type: "object",
            properties: {
                file_path: { type: "string", description: "Path to the file to edit" },
                old_string: { type: "string", description: "The exact text to find and replace (must match exactly including whitespace)" },
                new_string: { type: "string", description: "The replacement text" }
            },
            required: ["file_path", "old_string", "new_string"]
        }
    },
    {
        name: "run_code",
        description: "Execute Python or Node.js code in an isolated environment. Safer than raw bash for computation, data analysis, and scripting tasks. Captures stdout, stderr, and exit code.",
        parameters: {
            type: "object",
            properties: {
                language: { type: "string", enum: ["python", "javascript"], description: "Programming language to execute" },
                code: { type: "string", description: "The source code to execute" },
                timeout: { type: "number", description: "Timeout in seconds (default 30, max 120)" }
            },
            required: ["language", "code"]
        }
    },
    {
        name: "process_list",
        description: "List running processes on the system. Can filter by name. Returns PID, CPU%, MEM%, and command for each process.",
        parameters: {
            type: "object",
            properties: {
                filter: { type: "string", description: "Optional filter to match process names (case-insensitive)" },
                sortBy: { type: "string", enum: ["cpu", "mem", "pid"], description: "Sort by CPU, memory, or PID (default: cpu)" },
                limit: { type: "number", description: "Maximum processes to return (default 30, max 100)" }
            }
        }
    },
    {
        name: "port_check",
        description: "Check which process is using a specific port, or list all listening ports.",
        parameters: {
            type: "object",
            properties: {
                port: { type: "number", description: "Specific port number to check. If omitted, lists all listening ports." },
                protocol: { type: "string", enum: ["tcp", "udp", "all"], description: "Protocol filter (default: tcp)" }
            }
        }
    },
    {
        name: "grep_search",
        description: "Search for a text pattern across files in the project. Returns matching lines with file paths and line numbers. Essential for finding code references, function definitions, imports, and configuration values.",
        parameters: {
            type: "object",
            properties: {
                pattern: { type: "string", description: "Search pattern (regex supported, e.g., 'function\\s+myFunc', 'TODO', 'import.*from')" },
                directory: { type: "string", description: "Directory to search in (defaults to project root)" },
                include: { type: "string", description: "File glob pattern to filter (e.g., '*.ts', '*.py', '*.json')" },
                max_results: { type: "number", description: "Maximum results (default 50, max 200)" }
            },
            required: ["pattern"]
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

export const CAPABILITY_REGISTRY: Record<string, { tools: string[]; description: string }> = {
    research: {
        tools: ["web_search", "fetch_url", "openclaw_rag_search", "analyze_data"],
        description: "Information gathering, fact-checking, and research tasks",
    },
    "file-ops": {
        tools: ["list_files", "read_file", "bash"],
        description: "File system operations: reading, writing, listing, moving files",
    },
    "web-automation": {
        tools: ["browse_and_act", "fetch_url", "web_search"],
        description: "Browser-based interactions: forms, bookings, purchases, scraping",
    },
    "code-analysis": {
        tools: ["read_file", "run_code", "bash", "edit_file", "grep_search"],
        description: "Code reading, execution, debugging, and modification",
    },
    "data-processing": {
        tools: ["analyze_data", "generate_chart", "run_code", "read_file", "create_spreadsheet"],
        description: "Data analysis, visualization, and statistical computation",
    },
    "document-creation": {
        tools: ["create_presentation", "create_document", "create_spreadsheet"],
        description: "Creating Office documents: presentations, reports, spreadsheets",
    },
    "system-ops": {
        tools: ["process_list", "port_check", "bash"],
        description: "System administration: process management, ports, services",
    },
    "memory-retrieval": {
        tools: ["memory_search", "openclaw_rag_search"],
        description: "Retrieving stored knowledge, prior conversations, and documents",
    },
};
