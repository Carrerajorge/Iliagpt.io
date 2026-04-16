import {
  TaskPlan,
  Phase,
  Step,
  ITaskPlanner,
  createPhase,
  createStep,
  createTaskPlan,
} from "./agentTypes";

interface IntentPattern {
  intent: string;
  patterns: RegExp[];
}

interface IntentResult {
  intent: string;
  entities: Record<string, any>;
}

const INTENT_PATTERNS: IntentPattern[] = [
  {
    intent: "create_pptx",
    patterns: [
      /create\s+(a\s+)?presentation/i,
      /make\s+(a\s+)?powerpoint/i,
      /generate\s+(a\s+)?pptx/i,
      /crear\s+(una\s+)?presentaci[oó]n/i,
      /genera(r)?\s+(una\s+)?presentaci[oó]n/i,
      /hacer\s+(una\s+)?presentaci[oó]n/i,
      /new\s+presentation/i,
      /pptx\s+(about|on|for)/i,
    ],
  },
  {
    intent: "create_docx",
    patterns: [
      /create\s+(a\s+)?document/i,
      /write\s+(a\s+)?report/i,
      /make\s+(a\s+)?word\s+doc/i,
      /generate\s+(a\s+)?docx/i,
      /crear\s+(un\s+)?documento(\s+word)?/i,
      /escribir\s+(un\s+)?informe/i,
      /redactar\s+(un\s+)?documento/i,
      /new\s+document/i,
      /docx\s+(about|on|for)/i,
    ],
  },
  {
    intent: "create_xlsx",
    patterns: [
      /create\s+(a\s+)?(excel|spreadsheet)/i,
      /make\s+(a\s+)?(excel|spreadsheet)/i,
      /generate\s+(a\s+)?xlsx/i,
      /crear\s+(una\s+)?hoja\s+de\s+c[aá]lculo/i,
      /crear\s+(un\s+)?excel/i,
      /generar\s+(un\s+)?excel/i,
      /hacer\s+(una?\s+)?(hoja\s+de\s+c[aá]lculo|excel)/i,
      /new\s+(excel|spreadsheet)/i,
      /xlsx\s+(about|on|for)/i,
    ],
  },
  {
    intent: "research",
    patterns: [
      /research\s+(about|on)?/i,
      /investigate\s+(about|on)?/i,
      /deep\s+dive\s+(into|on)/i,
      /investiga(r)?\s+(sobre)?/i,
      /analiza(r)?\s+y\s+reporta(r)?/i,
      /study\s+(about|on)?/i,
      /explore\s+(about|on)?/i,
    ],
  },
  {
    intent: "search",
    patterns: [
      /^search\s+(for)?/i,
      /find\s+(info|information)?\s*(about|on)?/i,
      /look\s+up/i,
      /busca(r)?\s+(sobre|acerca)?/i,
      /encuentra(r)?/i,
      /query\s+(for)?/i,
    ],
  },
  {
    intent: "browse",
    patterns: [
      /navigate\s+to/i,
      /open\s+(the\s+)?url/i,
      /go\s+to\s+(the\s+)?(website|page|url)/i,
      /visit\s+(the\s+)?(website|page|url)?/i,
      /fetch\s+(the\s+)?(page|url|website)/i,
      /navega(r)?\s+(a|hacia)/i,
      /abrir?\s+(la\s+)?(p[aá]gina|url)/i,
      /browse\s+(to)?/i,
    ],
  },
  {
    intent: "file_create",
    patterns: [
      /create\s+(a\s+)?file/i,
      /write\s+(a\s+)?file/i,
      /save\s+(to|as)\s+(a\s+)?file/i,
      /crea(r)?\s+(un\s+)?archivo/i,
      /escrib(e|ir)\s+(un\s+)?archivo/i,
      /guardar\s+(como|en)\s+(un\s+)?archivo/i,
      /new\s+file/i,
    ],
  },
  {
    intent: "file_read",
    patterns: [
      /read\s+(the\s+)?file/i,
      /show\s+(the\s+)?file/i,
      /display\s+(the\s+)?file/i,
      /open\s+(the\s+)?file/i,
      /lee(r)?\s+(el\s+)?archivo/i,
      /muestra(r)?\s+(el\s+)?archivo/i,
      /ver\s+(el\s+)?archivo/i,
      /cat\s+/i,
      /view\s+(the\s+)?file/i,
    ],
  },
  {
    intent: "file_list",
    patterns: [
      /list\s+(the\s+)?files/i,
      /show\s+(the\s+)?directory/i,
      /show\s+(the\s+)?folder/i,
      /lista(r)?\s+(los\s+)?archivos/i,
      /mostrar\s+(el\s+)?directorio/i,
      /ver\s+(el\s+)?contenido\s+del?\s+(directorio|carpeta)/i,
      /ls\s+/i,
      /dir\s+/i,
    ],
  },
  {
    intent: "code",
    patterns: [
      /run\s+(the\s+)?python/i,
      /execute\s+(the\s+)?code/i,
      /run\s+(the\s+)?script/i,
      /ejecuta(r)?\s+(el\s+)?c[oó]digo/i,
      /correr\s+(el\s+)?script/i,
      /python\s+-c/i,
      /eval(uate)?\s+(the\s+)?code/i,
    ],
  },
  {
    intent: "help",
    patterns: [
      /^help$/i,
      /^help\s+me/i,
      /what\s+can\s+you\s+do/i,
      /show\s+(me\s+)?commands/i,
      /^ayuda$/i,
      /c[oó]mo\s+(te\s+)?uso/i,
      /qu[eé]\s+puedes\s+hacer/i,
      /available\s+commands/i,
    ],
  },
  {
    intent: "system",
    patterns: [
      /system\s+info/i,
      /system\s+status/i,
      /show\s+(system\s+)?info/i,
      /info\s+del\s+sistema/i,
      /estado\s+del\s+sistema/i,
      /environment\s+info/i,
      /env\s+info/i,
    ],
  },
];

export class TaskPlanner implements ITaskPlanner {
  private intentPatterns: IntentPattern[];

  constructor() {
    this.intentPatterns = INTENT_PATTERNS;
  }

  async detectIntent(text: string): Promise<IntentResult> {
    const normalizedText = text.trim().toLowerCase();

    for (const { intent, patterns } of this.intentPatterns) {
      for (const pattern of patterns) {
        if (pattern.test(text)) {
          const entities = this.extractEntities(text);
          return { intent, entities };
        }
      }
    }

    const entities = this.extractEntities(text);
    return { intent: "unknown", entities };
  }

  private extractEntities(text: string): Record<string, any> {
    const entities: Record<string, any> = {};

    const urlRegex = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/gi;
    const urls = text.match(urlRegex);
    if (urls && urls.length > 0) {
      entities.urls = urls;
      entities.url = urls[0];
    }

    const fileRegex = /(?:^|\s)([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]{1,10})(?:\s|$|[,;])/g;
    const files: string[] = [];
    let fileMatch;
    while ((fileMatch = fileRegex.exec(text)) !== null) {
      const file = fileMatch[1];
      if (!file.startsWith("http") && !file.startsWith("www.")) {
        files.push(file);
      }
    }
    if (files.length > 0) {
      entities.files = files;
      entities.file = files[0];
    }

    const quotedRegex = /"([^"]+)"|'([^']+)'|«([^»]+)»|"([^"]+)"/g;
    const quotedTexts: string[] = [];
    let quotedMatch;
    while ((quotedMatch = quotedRegex.exec(text)) !== null) {
      const quoted = quotedMatch[1] || quotedMatch[2] || quotedMatch[3] || quotedMatch[4];
      if (quoted) {
        quotedTexts.push(quoted);
      }
    }
    if (quotedTexts.length > 0) {
      entities.quotedText = quotedTexts;
      entities.title = quotedTexts[0];
    }

    const topicPatterns = [
      /(?:about|on|regarding|concerning|over)\s+(.+?)(?:\.|$|,|\s+and\s+|\s+with\s+)/i,
      /(?:sobre|acerca\s+de|referente\s+a)\s+(.+?)(?:\.|$|,|\s+y\s+|\s+con\s+)/i,
      /(?:research|investigate|study|explore|search\s+for)\s+(.+?)(?:\.|$|,)/i,
      /(?:create|make|generate|build)\s+(?:a\s+)?(?:presentation|document|report|excel)\s+(?:about|on|for)\s+(.+?)(?:\.|$|,)/i,
    ];

    for (const pattern of topicPatterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        entities.topic = match[1].trim();
        break;
      }
    }

    if (!entities.topic) {
      const words = text.split(/\s+/).filter((w) => w.length > 3);
      const skipWords = new Set([
        "create", "make", "generate", "write", "build", "show", "find",
        "search", "about", "presentation", "document", "report", "excel",
        "file", "help", "please", "want", "need", "would", "like", "could",
        "crear", "hacer", "generar", "escribir", "mostrar", "buscar",
        "sobre", "para", "archivo", "documento", "presentación",
      ]);
      const significantWords = words.filter((w) => !skipWords.has(w.toLowerCase()));
      if (significantWords.length > 0) {
        entities.topic = significantWords.slice(0, 5).join(" ");
      }
    }

    return entities;
  }

  async createPlan(userInput: string): Promise<TaskPlan> {
    const { intent, entities } = await this.detectIntent(userInput);
    const taskId = this.generateTaskId();
    const objective = this.createObjective(intent, entities, userInput);

    let phases: Phase[];

    switch (intent) {
      case "create_pptx":
        phases = this.createPptxPlan(entities);
        break;
      case "create_docx":
        phases = this.createDocxPlan(entities);
        break;
      case "create_xlsx":
        phases = this.createXlsxPlan(entities);
        break;
      case "research":
        phases = this.createResearchPlan(entities);
        break;
      case "search":
        phases = this.createSearchPlan(entities);
        break;
      case "browse":
        phases = this.createBrowsePlan(entities);
        break;
      case "file_create":
        phases = this.createFileCreatePlan(entities);
        break;
      case "file_read":
        phases = this.createFileReadPlan(entities);
        break;
      case "file_list":
        phases = this.createFileListPlan(entities);
        break;
      case "code":
        phases = this.createCodePlan(entities, userInput);
        break;
      case "help":
        phases = this.createHelpPlan();
        break;
      case "system":
        phases = this.createSystemPlan();
        break;
      default:
        phases = this.createDefaultPlan(entities, userInput);
    }

    return createTaskPlan(taskId, objective, phases);
  }

  private generateTaskId(): string {
    return `task_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  }

  private createObjective(intent: string, entities: Record<string, any>, userInput: string): string {
    let topic = entities.topic || entities.title || "";
    topic = topic.replace(/^(about|on|sobre|acerca\s+de)\s+/i, "").trim();
    
    switch (intent) {
      case "create_pptx":
        return `Create a PowerPoint presentation${topic ? ` about ${topic}` : ""}`;
      case "create_docx":
        return `Create a Word document${topic ? ` about ${topic}` : ""}`;
      case "create_xlsx":
        return `Create an Excel spreadsheet${topic ? ` for ${topic}` : ""}`;
      case "research":
        return `Research and analyze${topic ? ` ${topic}` : " the requested topic"}`;
      case "search":
        return `Search for information${topic ? ` about ${topic}` : ""}`;
      case "browse":
        return `Navigate to and extract content from ${entities.url || "the specified URL"}`;
      case "file_create":
        return `Create file ${entities.file || "as requested"}`;
      case "file_read":
        return `Read and display ${entities.file || "the specified file"}`;
      case "file_list":
        return `List files in directory`;
      case "code":
        return `Execute the requested code`;
      case "help":
        return `Display available commands and capabilities`;
      case "system":
        return `Show system information and status`;
      default:
        return userInput.substring(0, 100);
    }
  }

  private createPptxPlan(entities: Record<string, any>): Phase[] {
    const topic = entities.topic || entities.title || "Untitled";
    const hasUrls = entities.urls && entities.urls.length > 0;

    const phases: Phase[] = [];

    if (hasUrls || entities.topic) {
      phases.push(
        createPhase("research", "Research", "Gather information for the presentation", "🔍", [
          createStep("search_topic", "Search for information", "search", { query: topic }),
          ...(hasUrls
            ? [createStep("fetch_url", "Fetch content from URL", "browser", { url: entities.url })]
            : []),
        ])
      );
    }

    phases.push(
      createPhase("analyze", "Analyze", "Analyze and structure the content", "📊", [
        createStep("structure_content", "Structure presentation content", "message", {
          content: `Analyzing content for: ${topic}`,
          format: "text",
        }),
      ])
    );

    phases.push(
      createPhase("create", "Create", "Generate the PowerPoint presentation", "📑", [
        createStep("generate_pptx", "Generate PowerPoint file", "document", {
          type: "pptx",
          title: topic,
          slides: [],
        }),
      ])
    );

    phases.push(
      createPhase("deliver", "Deliver", "Present the final result", "✅", [
        createStep("notify_complete", "Notify completion", "message", {
          content: `Presentation "${topic}" has been created successfully`,
          format: "markdown",
          type: "success",
        }),
      ])
    );

    return phases;
  }

  private createDocxPlan(entities: Record<string, any>): Phase[] {
    const topic = entities.topic || entities.title || "Untitled Document";
    const hasUrls = entities.urls && entities.urls.length > 0;

    const phases: Phase[] = [];

    if (hasUrls || entities.topic) {
      phases.push(
        createPhase("research", "Research", "Gather information for the document", "🔍", [
          createStep("search_topic", "Search for information", "search", { query: topic }),
          ...(hasUrls
            ? [createStep("fetch_url", "Fetch content from URL", "browser", { url: entities.url })]
            : []),
        ])
      );
    }

    phases.push(
      createPhase("draft", "Draft", "Create document structure and draft", "📝", [
        createStep("outline_doc", "Create document outline", "message", {
          content: `Creating outline for: ${topic}`,
          format: "text",
        }),
      ])
    );

    phases.push(
      createPhase("create", "Create", "Generate the Word document", "📄", [
        createStep("generate_docx", "Generate Word document", "document", {
          type: "docx",
          title: topic,
          sections: [],
        }),
      ])
    );

    phases.push(
      createPhase("deliver", "Deliver", "Present the final document", "✅", [
        createStep("notify_complete", "Notify completion", "message", {
          content: `Document "${topic}" has been created successfully`,
          format: "markdown",
          type: "success",
        }),
      ])
    );

    return phases;
  }

  private createXlsxPlan(entities: Record<string, any>): Phase[] {
    const topic = entities.topic || entities.title || "Untitled Spreadsheet";

    const phases: Phase[] = [];

    phases.push(
      createPhase("prepare", "Prepare", "Prepare spreadsheet structure", "📋", [
        createStep("define_structure", "Define spreadsheet structure", "message", {
          content: `Preparing structure for: ${topic}`,
          format: "text",
        }),
      ])
    );

    phases.push(
      createPhase("create", "Create", "Generate the Excel spreadsheet", "📊", [
        createStep("generate_xlsx", "Generate Excel file", "document", {
          type: "xlsx",
          title: topic,
          sheets: [],
        }),
      ])
    );

    phases.push(
      createPhase("deliver", "Deliver", "Present the final spreadsheet", "✅", [
        createStep("notify_complete", "Notify completion", "message", {
          content: `Spreadsheet "${topic}" has been created successfully`,
          format: "markdown",
          type: "success",
        }),
      ])
    );

    return phases;
  }

  private createResearchPlan(entities: Record<string, any>): Phase[] {
    const topic = entities.topic || "the requested topic";

    return [
      createPhase("search", "Search", "Search for relevant information", "🔍", [
        createStep("web_search", "Perform web search", "search", { query: topic }),
      ]),
      createPhase("gather", "Gather", "Gather detailed content from sources", "📥", [
        createStep("deep_research", "Perform deep research", "research", {
          query: topic,
          maxPages: 5,
          extractContent: true,
        }),
      ]),
      createPhase("analyze", "Analyze", "Analyze and synthesize findings", "🔬", [
        createStep("synthesize", "Synthesize research findings", "message", {
          content: `Analyzing research results for: ${topic}`,
          format: "markdown",
        }),
      ]),
      createPhase("report", "Report", "Create research report", "📝", [
        createStep("create_report", "Generate research report", "document", {
          type: "docx",
          title: `Research Report: ${topic}`,
          sections: [],
        }),
      ]),
      createPhase("deliver", "Deliver", "Deliver research results", "✅", [
        createStep("notify_complete", "Notify completion", "message", {
          content: `Research on "${topic}" completed`,
          format: "markdown",
          type: "success",
        }),
      ]),
    ];
  }

  private createSearchPlan(entities: Record<string, any>): Phase[] {
    const query = entities.topic || entities.quotedText?.[0] || "";

    return [
      createPhase("search", "Search", "Execute search query", "🔍", [
        createStep("execute_search", "Search the web", "search", { query, maxResults: 10 }),
      ]),
      createPhase("deliver", "Deliver", "Present search results", "✅", [
        createStep("show_results", "Display search results", "message", {
          content: `Search results for: ${query}`,
          format: "markdown",
        }),
      ]),
    ];
  }

  private createBrowsePlan(entities: Record<string, any>): Phase[] {
    const url = entities.url || entities.urls?.[0] || "";

    return [
      createPhase("fetch", "Fetch", "Fetch the web page", "🌐", [
        createStep("fetch_page", "Fetch and extract page content", "browser", {
          url,
          extractText: true,
        }),
      ]),
      createPhase("deliver", "Deliver", "Present the content", "✅", [
        createStep("show_content", "Display extracted content", "message", {
          content: `Content from: ${url}`,
          format: "markdown",
        }),
      ]),
    ];
  }

  private createFileCreatePlan(entities: Record<string, any>): Phase[] {
    const filename = entities.file || entities.files?.[0] || "output.txt";
    const content = entities.quotedText?.[0] || "";

    return [
      createPhase("create", "Create", "Create the file", "📝", [
        createStep("write_file", "Write file to disk", "file", {
          operation: "write",
          path: filename,
          content,
        }),
      ]),
      createPhase("deliver", "Deliver", "Confirm file creation", "✅", [
        createStep("confirm", "Confirm file created", "message", {
          content: `File "${filename}" created successfully`,
          format: "text",
          type: "success",
        }),
      ]),
    ];
  }

  private createFileReadPlan(entities: Record<string, any>): Phase[] {
    const filename = entities.file || entities.files?.[0] || "";

    return [
      createPhase("read", "Read", "Read the file", "📖", [
        createStep("read_file", "Read file contents", "file", {
          operation: "read",
          path: filename,
        }),
      ]),
      createPhase("deliver", "Deliver", "Display file contents", "✅", [
        createStep("show_content", "Display file contents", "message", {
          content: `Contents of: ${filename}`,
          format: "text",
        }),
      ]),
    ];
  }

  private createFileListPlan(entities: Record<string, any>): Phase[] {
    const path = entities.file || ".";

    return [
      createPhase("list", "List", "List directory contents", "📂", [
        createStep("list_dir", "List files in directory", "file", {
          operation: "list",
          path,
          recursive: false,
        }),
      ]),
      createPhase("deliver", "Deliver", "Display directory listing", "✅", [
        createStep("show_listing", "Display file listing", "message", {
          content: `Directory listing for: ${path}`,
          format: "text",
        }),
      ]),
    ];
  }

  private createCodePlan(entities: Record<string, any>, userInput: string): Phase[] {
    const code = entities.quotedText?.[0] || this.extractCode(userInput);

    return [
      createPhase("execute", "Execute", "Execute the code", "⚙️", [
        createStep("run_code", "Run Python code", "python", {
          code,
          timeout: 60000,
        }),
      ]),
      createPhase("deliver", "Deliver", "Present execution results", "✅", [
        createStep("show_output", "Display execution output", "message", {
          content: "Code execution completed",
          format: "text",
        }),
      ]),
    ];
  }

  private createHelpPlan(): Phase[] {
    return [
      createPhase("help", "Help", "Display help information", "❓", [
        createStep("show_help", "Show available commands", "message", {
          content: `**Available Commands:**

• **Create Presentation** - "create presentation about [topic]"
• **Create Document** - "create document about [topic]"  
• **Create Spreadsheet** - "create excel for [topic]"
• **Research** - "research [topic]"
• **Search** - "search for [query]"
• **Browse URL** - "navigate to [url]"
• **Create File** - "create file [name]"
• **Read File** - "read file [name]"
• **List Files** - "list files"
• **Run Code** - "run python [code]"
• **System Info** - "system info"`,
          format: "markdown",
          type: "info",
        }),
      ]),
    ];
  }

  private createSystemPlan(): Phase[] {
    return [
      createPhase("gather", "Gather", "Gather system information", "🖥️", [
        createStep("get_system_info", "Get system information", "shell", {
          command: "uname -a && echo '---' && node --version && echo '---' && python3 --version",
        }),
      ]),
      createPhase("deliver", "Deliver", "Display system information", "✅", [
        createStep("show_info", "Display system info", "message", {
          content: "System information retrieved",
          format: "text",
        }),
      ]),
    ];
  }

  private createDefaultPlan(entities: Record<string, any>, userInput: string): Phase[] {
    return [
      createPhase("analyze", "Analyze", "Analyze the request", "🔍", [
        createStep("analyze_request", "Analyze user request", "message", {
          content: `Analyzing request: ${userInput.substring(0, 100)}`,
          format: "text",
        }),
      ]),
      createPhase("respond", "Respond", "Respond to the user", "💬", [
        createStep("generate_response", "Generate response", "message", {
          content: userInput,
          format: "markdown",
        }),
      ]),
    ];
  }

  private extractCode(text: string): string {
    const codeBlockMatch = text.match(/```(?:python)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      return codeBlockMatch[1].trim();
    }

    const inlineCodeMatch = text.match(/`([^`]+)`/);
    if (inlineCodeMatch) {
      return inlineCodeMatch[1].trim();
    }

    const afterRun = text.match(/(?:run|execute|eval)\s+(?:python\s+)?(.+)/i);
    if (afterRun) {
      return afterRun[1].trim();
    }

    return text;
  }
}

export const taskPlanner = new TaskPlanner();
