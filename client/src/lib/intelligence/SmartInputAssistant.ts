/**
 * SmartInputAssistant — slash commands, templates, autocomplete, file detection.
 */

import { clientSideInference } from './ClientSideInference'

export interface SlashCommand {
  name: string
  trigger: string
  description: string
  example?: string
  icon?: string
  category: 'research' | 'creative' | 'code' | 'quick' | 'utility'
  params?: Array<{ name: string; description: string; optional?: boolean }>
}

export interface TemplateSuggestion {
  label: string
  template: string
  category: string
  icon?: string
  variables?: string[]
}

export interface InputSuggestion {
  type: 'slash_command' | 'template' | 'completion' | 'file_action'
  text: string
  description?: string
  icon?: string
  score: number
  action?: () => void
}

export interface FileDropInfo {
  file: File
  suggestedAction: string
  suggestedPrompt: string
  preview?: string
}

// ---------------------------------------------------------------------------
// Built-in slash commands
// ---------------------------------------------------------------------------

const BUILT_IN_COMMANDS: SlashCommand[] = [
  {
    name: 'deep',
    trigger: '/deep',
    description: 'Deep research mode — multiple web searches with synthesis',
    example: '/deep What are the latest breakthroughs in quantum computing?',
    icon: 'Search',
    category: 'research',
    params: [{ name: 'query', description: 'Research topic or question' }],
  },
  {
    name: 'quick',
    trigger: '/quick',
    description: 'Quick response with no external lookups',
    example: '/quick Summarize this in one sentence',
    icon: 'Zap',
    category: 'quick',
  },
  {
    name: 'code',
    trigger: '/code',
    description: 'Code-focused response with syntax highlighting',
    example: '/code Write a TypeScript utility to debounce async functions',
    icon: 'Code2',
    category: 'code',
    params: [
      { name: 'language', description: 'Programming language', optional: true },
      { name: 'task', description: 'What to implement' },
    ],
  },
  {
    name: 'research',
    trigger: '/research',
    description: 'Academic research mode — arxiv, pubmed, semantic scholar',
    example: '/research Recent papers on retrieval-augmented generation',
    icon: 'BookOpen',
    category: 'research',
    params: [{ name: 'topic', description: 'Research topic' }],
  },
  {
    name: 'creative',
    trigger: '/creative',
    description: 'Creative writing mode — stories, poems, scripts',
    example: '/creative Write a short story about an AI discovering emotions',
    icon: 'Feather',
    category: 'creative',
  },
  {
    name: 'analyze',
    trigger: '/analyze',
    description: 'Data analysis mode — structured breakdown and insights',
    example: '/analyze Compare these two datasets and identify trends',
    icon: 'BarChart2',
    category: 'utility',
  },
  {
    name: 'summarize',
    trigger: '/summarize',
    description: 'Summarize a document or block of text',
    example: '/summarize [paste text here]',
    icon: 'FileText',
    category: 'quick',
  },
  {
    name: 'translate',
    trigger: '/translate',
    description: 'Translate text to a specified language',
    example: '/translate to Spanish: Hello, how are you?',
    icon: 'Languages',
    category: 'utility',
    params: [
      { name: 'language', description: 'Target language' },
      { name: 'text', description: 'Text to translate' },
    ],
  },
  {
    name: 'explain',
    trigger: '/explain',
    description: 'Explain a concept in simple, accessible terms',
    example: '/explain How does attention work in transformers?',
    icon: 'Lightbulb',
    category: 'quick',
    params: [{ name: 'concept', description: 'Concept or topic to explain' }],
  },
  {
    name: 'compare',
    trigger: '/compare',
    description: 'Compare two or more items with a structured breakdown',
    example: '/compare React vs Vue for a large SPA project',
    icon: 'GitCompare',
    category: 'utility',
    params: [{ name: 'items', description: 'Items to compare' }],
  },
]

// ---------------------------------------------------------------------------
// Built-in templates
// ---------------------------------------------------------------------------

const BUILT_IN_TEMPLATES: TemplateSuggestion[] = [
  // Comparison
  {
    label: 'Compare two things',
    template: 'What are the key differences between {X} and {Y}? Include pros, cons, and use cases.',
    category: 'Comparison',
    icon: 'GitCompare',
    variables: ['X', 'Y'],
  },
  {
    label: 'Best option for use case',
    template: 'What is the best option for {USE_CASE} between {OPTIONS}? Justify your recommendation.',
    category: 'Comparison',
    icon: 'GitCompare',
    variables: ['USE_CASE', 'OPTIONS'],
  },

  // Explanation
  {
    label: 'Explain a concept simply',
    template: 'Explain {CONCEPT} in simple terms that a beginner could understand. Include an analogy.',
    category: 'Explanation',
    icon: 'Lightbulb',
    variables: ['CONCEPT'],
  },
  {
    label: 'How does X work?',
    template: 'How does {TOPIC} work under the hood? Walk me through the key steps.',
    category: 'Explanation',
    icon: 'Lightbulb',
    variables: ['TOPIC'],
  },

  // Analysis
  {
    label: 'Analyze pros and cons',
    template: 'Analyze the pros and cons of {SUBJECT}. Be balanced and thorough.',
    category: 'Analysis',
    icon: 'BarChart2',
    variables: ['SUBJECT'],
  },
  {
    label: 'SWOT analysis',
    template: 'Perform a SWOT analysis (Strengths, Weaknesses, Opportunities, Threats) for {SUBJECT}.',
    category: 'Analysis',
    icon: 'BarChart2',
    variables: ['SUBJECT'],
  },
  {
    label: 'Root cause analysis',
    template: 'Help me identify the root cause of {PROBLEM}. What are the likely causes and how can I investigate?',
    category: 'Analysis',
    icon: 'Search',
    variables: ['PROBLEM'],
  },

  // Creative
  {
    label: 'Write a short story',
    template: 'Write a short story about {THEME}. Make it engaging and approximately 500 words.',
    category: 'Creative',
    icon: 'Feather',
    variables: ['THEME'],
  },
  {
    label: 'Write a poem',
    template: 'Write a {STYLE} poem about {SUBJECT}.',
    category: 'Creative',
    icon: 'Feather',
    variables: ['STYLE', 'SUBJECT'],
  },
  {
    label: 'Brainstorm ideas',
    template: 'Brainstorm 10 creative ideas for {TOPIC}. Be original and diverse.',
    category: 'Creative',
    icon: 'Sparkles',
    variables: ['TOPIC'],
  },

  // Code
  {
    label: 'Implement a function',
    template: 'Write a {LANGUAGE} function that {DESCRIPTION}. Include type annotations, error handling, and a usage example.',
    category: 'Code',
    icon: 'Code2',
    variables: ['LANGUAGE', 'DESCRIPTION'],
  },
  {
    label: 'Code review',
    template: 'Review the following {LANGUAGE} code for correctness, performance, security, and style:\n\n```{LANGUAGE}\n{CODE}\n```',
    category: 'Code',
    icon: 'Code2',
    variables: ['LANGUAGE', 'CODE'],
  },
  {
    label: 'Debug this error',
    template: 'I am getting this error:\n\n```\n{ERROR}\n```\n\nHere is the relevant code:\n\n```{LANGUAGE}\n{CODE}\n```\n\nWhat is causing this and how do I fix it?',
    category: 'Code',
    icon: 'Bug',
    variables: ['ERROR', 'LANGUAGE', 'CODE'],
  },

  // Research
  {
    label: 'Research a topic',
    template: 'Provide a comprehensive overview of {TOPIC}. Cover: background, current state, key challenges, and future outlook.',
    category: 'Research',
    icon: 'BookOpen',
    variables: ['TOPIC'],
  },
  {
    label: 'Summarize a field',
    template: 'Summarize the current state of {FIELD} research as of {YEAR}. What are the most important recent developments?',
    category: 'Research',
    icon: 'BookOpen',
    variables: ['FIELD', 'YEAR'],
  },
]

// ---------------------------------------------------------------------------
// SmartInputAssistant
// ---------------------------------------------------------------------------

class SmartInputAssistant {
  private slashCommands: SlashCommand[]
  private templates: TemplateSuggestion[]
  private customTemplates: TemplateSuggestion[] = []
  private inference = clientSideInference

  constructor() {
    this.slashCommands = this.buildSlashCommands()
    this.templates = this.buildTemplates()
  }

  getSuggestions(
    input: string,
    cursorPos: number,
    context?: { recentMessages?: string[] }
  ): InputSuggestion[] {
    const trimmed = input.trim()

    // Slash command suggestions
    if (trimmed.startsWith('/')) {
      const partial = trimmed.slice(1).toLowerCase()
      return this.slashCommands
        .filter(cmd => cmd.name.startsWith(partial))
        .slice(0, 5)
        .map((cmd, i) => ({
          type: 'slash_command' as const,
          text: cmd.trigger,
          description: cmd.description,
          icon: cmd.icon,
          score: 1 - i * 0.05,
        }))
    }

    // Empty input — show template suggestions
    if (trimmed.length === 0) {
      return this.templates
        .concat(this.customTemplates)
        .slice(0, 5)
        .map((t, i) => ({
          type: 'template' as const,
          text: t.template,
          description: t.label,
          icon: t.icon,
          score: 1 - i * 0.05,
        }))
    }

    // 3+ chars — get typing completions (synchronous heuristic)
    if (trimmed.length >= 3) {
      return this.heuristicCompletions(trimmed, cursorPos)
    }

    return []
  }

  private heuristicCompletions(input: string, cursorPos: number): InputSuggestion[] {
    const lower = input.toLowerCase()
    const suggestions: InputSuggestion[] = []

    const COMPLETIONS: Array<{ pattern: RegExp; completions: string[] }> = [
      { pattern: /^how do i\s*$/i, completions: ['how do I solve...', 'how do I implement...', 'how do I fix...'] },
      { pattern: /^what is\s*$/i, completions: ['what is the difference between...', 'what is the best way to...', 'what is a good...'] },
      { pattern: /^can you\s*$/i, completions: ['can you help me with...', 'can you explain how to...', 'can you write a...'] },
      { pattern: /^write a\s*$/i, completions: ['write a function that...', 'write a React component for...', 'write a script to...'] },
      { pattern: /^explain\s*$/i, completions: ['explain how this works', 'explain the concept of...', 'explain the difference between...'] },
      { pattern: /^analyze\s*$/i, completions: ['analyze this code', 'analyze the following data', 'analyze the performance of...'] },
    ]

    for (const { pattern, completions } of COMPLETIONS) {
      if (pattern.test(lower)) {
        completions.slice(0, 3).forEach((c, i) => {
          suggestions.push({
            type: 'completion',
            text: c,
            score: 0.8 - i * 0.1,
          })
        })
        break
      }
    }

    return suggestions.slice(0, 5)
  }

  getSlashCommands(filter?: string): SlashCommand[] {
    if (!filter) return this.slashCommands
    const lower = filter.toLowerCase()
    return this.slashCommands.filter(
      cmd =>
        cmd.name.includes(lower) ||
        cmd.description.toLowerCase().includes(lower) ||
        cmd.category.includes(lower)
    )
  }

  detectSlashCommand(input: string): { command: SlashCommand; args: string } | null {
    const trimmed = input.trim()
    if (!trimmed.startsWith('/')) return null

    for (const cmd of this.slashCommands) {
      if (trimmed.toLowerCase().startsWith(cmd.trigger.toLowerCase())) {
        const args = trimmed.slice(cmd.trigger.length).trim()
        return { command: cmd, args }
      }
    }

    return null
  }

  processFileDrops(files: FileList | File[]): FileDropInfo[] {
    const fileArray = Array.from(files)
    return fileArray.map(file => this.analyzeFile(file))
  }

  private analyzeFile(file: File): FileDropInfo {
    const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
    const type = file.type.toLowerCase()

    if (type === 'application/pdf' || ext === 'pdf') {
      return {
        file,
        suggestedAction: 'Analyze PDF document',
        suggestedPrompt: `Analyze this PDF document: "${file.name}". Provide a summary, key points, and any notable information.`,
      }
    }

    if (['csv', 'xlsx', 'xls', 'ods'].includes(ext) || type.includes('spreadsheet') || type === 'text/csv') {
      return {
        file,
        suggestedAction: 'Analyze spreadsheet data',
        suggestedPrompt: `Analyze this spreadsheet: "${file.name}". Describe the data structure, identify patterns, and provide key insights.`,
      }
    }

    if (
      ['js', 'ts', 'jsx', 'tsx', 'py', 'go', 'rs', 'java', 'c', 'cpp', 'cs', 'rb', 'php', 'swift', 'kt'].includes(ext)
    ) {
      return {
        file,
        suggestedAction: 'Review code',
        suggestedPrompt: `Review this ${ext.toUpperCase()} code file: "${file.name}". Check for bugs, suggest improvements, and explain what it does.`,
      }
    }

    if (type.startsWith('image/')) {
      return {
        file,
        suggestedAction: 'Analyze image',
        suggestedPrompt: `Analyze this image: "${file.name}". Describe what you see and provide any relevant insights.`,
      }
    }

    if (['docx', 'doc'].includes(ext) || type.includes('word')) {
      return {
        file,
        suggestedAction: 'Summarize document',
        suggestedPrompt: `Summarize this Word document: "${file.name}". Extract key points, main arguments, and conclusions.`,
      }
    }

    if (ext === 'json') {
      return {
        file,
        suggestedAction: 'Analyze JSON data',
        suggestedPrompt: `Analyze this JSON file: "${file.name}". Explain the data structure and key fields.`,
      }
    }

    if (['md', 'txt', 'rst'].includes(ext) || type === 'text/plain' || type === 'text/markdown') {
      return {
        file,
        suggestedAction: 'Read and summarize text',
        suggestedPrompt: `Read and summarize this text file: "${file.name}". Provide an overview and key points.`,
      }
    }

    // Default
    return {
      file,
      suggestedAction: 'Analyze file',
      suggestedPrompt: `Analyze this file: "${file.name}". Provide relevant information and insights.`,
    }
  }

  getTemplates(category?: string): TemplateSuggestion[] {
    const all = [...this.templates, ...this.customTemplates]
    if (!category) return all
    return all.filter(t => t.category.toLowerCase() === category.toLowerCase())
  }

  fillTemplate(template: TemplateSuggestion, variables: Record<string, string>): string {
    let result = template.template
    for (const [key, value] of Object.entries(variables)) {
      result = result.replaceAll(`{${key}}`, value)
    }
    return result
  }

  extractVariables(template: string): string[] {
    const matches = template.match(/\{([A-Z_]+)\}/g) ?? []
    const unique = [...new Set(matches.map(m => m.slice(1, -1)))]
    return unique
  }

  addCustomTemplate(template: TemplateSuggestion): void {
    this.customTemplates.push(template)
  }

  removeCustomTemplate(label: string): void {
    this.customTemplates = this.customTemplates.filter(t => t.label !== label)
  }

  private buildSlashCommands(): SlashCommand[] {
    return BUILT_IN_COMMANDS
  }

  private buildTemplates(): TemplateSuggestion[] {
    return BUILT_IN_TEMPLATES
  }
}

export const smartInputAssistant = new SmartInputAssistant()
