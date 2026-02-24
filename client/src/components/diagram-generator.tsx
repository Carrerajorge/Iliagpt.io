/**
 * Diagram Generator Component - ILIAGPT PRO 3.0
 * 
 * Visual diagram creation from text descriptions.
 * Supports flowcharts, sequence diagrams, ERD.
 */

import React, { useState, useCallback, useEffect, useRef } from "react";
import DOMPurify from "dompurify";

// ============== Types ==============

type DiagramType = "flowchart" | "sequence" | "class" | "erd" | "mindmap";

interface DiagramConfig {
    type: DiagramType;
    code: string;
    theme: "default" | "dark" | "forest" | "neutral";
    direction: "TB" | "LR" | "BT" | "RL";
}

// ============== Templates ==============

const TEMPLATES: Record<DiagramType, string> = {
    flowchart: `graph TD
    A[Start] --> B{Decision}
    B -->|Yes| C[Process 1]
    B -->|No| D[Process 2]
    C --> E[End]
    D --> E`,
    sequence: `sequenceDiagram
    participant User
    participant API
    participant Database
    
    User->>API: Request
    API->>Database: Query
    Database-->>API: Result
    API-->>User: Response`,
    class: `classDiagram
    class User {
        +String id
        +String name
        +login()
        +logout()
    }
    class Admin {
        +manageUsers()
    }
    User <|-- Admin`,
    erd: `erDiagram
    USER ||--o{ CHAT : creates
    CHAT ||--|{ MESSAGE : contains
    USER {
        uuid id PK
        string email
        string name
    }
    CHAT {
        uuid id PK
        uuid user_id FK
        string title
    }
    MESSAGE {
        uuid id PK
        uuid chat_id FK
        string content
    }`,
    mindmap: `mindmap
    root((ILIAGPT PRO))
        Features
            AI Chat
            Document Analysis
            Code Assistant
        Technology
            React
            Node.js
            Grok API
        Users
            Free
            Pro
            Enterprise`,
};

// ============== Component ==============

export function DiagramGenerator() {
    const [config, setConfig] = useState<DiagramConfig>({
        type: "flowchart",
        code: TEMPLATES.flowchart,
        theme: "dark",
        direction: "TB",
    });

    const [error, setError] = useState<string | null>(null);
    const [rendered, setRendered] = useState<string>("");
    const previewRef = useRef<HTMLDivElement>(null);

    // ======== Rendering ========

    const renderDiagram = useCallback(async () => {
        try {
            // In production, use mermaid.js library
            // const { svg } = await mermaid.render('diagram', config.code);

            // Mock SVG for demo
            const mockSvg = generateMockSvg(config);
            setRendered(mockSvg);
            setError(null);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Failed to render diagram");
        }
    }, [config]);

    useEffect(() => {
        const timeout = setTimeout(renderDiagram, 500);
        return () => clearTimeout(timeout);
    }, [renderDiagram]);

    // ======== Type Change ========

    const handleTypeChange = useCallback((type: DiagramType) => {
        setConfig(c => ({
            ...c,
            type,
            code: TEMPLATES[type],
        }));
    }, []);

    // ======== Export ========

    const exportSvg = useCallback(() => {
        const blob = new Blob([rendered], { type: "image/svg+xml" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `diagram-${config.type}.svg`;
        a.click();
        URL.revokeObjectURL(url);
    }, [rendered, config.type]);

    const copyCode = useCallback(() => {
        navigator.clipboard.writeText(config.code);
    }, [config.code]);

    // ======== Render ========

    return (
        <div className="flex h-full bg-gray-900 text-white">
            {/* Sidebar */}
            <div className="w-72 border-r border-gray-700 flex flex-col">
                {/* Type Selector */}
                <div className="p-4 border-b border-gray-700">
                    <label className="text-xs text-gray-400 uppercase">Diagram Type</label>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                        {(Object.keys(TEMPLATES) as DiagramType[]).map(type => (
                            <button
                                key={type}
                                className={`px-3 py-2 rounded text-sm capitalize ${config.type === type ? "bg-blue-600" : "bg-gray-800 hover:bg-gray-700"
                                    }`}
                                onClick={() => handleTypeChange(type)}
                            >
                                {type === "erd" ? "ERD" : type}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Settings */}
                <div className="p-4 border-b border-gray-700 space-y-4">
                    <div>
                        <label className="text-xs text-gray-400 uppercase">Theme</label>
                        <select
                            value={config.theme}
                            onChange={(e) => setConfig(c => ({ ...c, theme: e.target.value as any }))}
                            className="w-full mt-1 px-3 py-2 bg-gray-800 rounded text-sm"
                        >
                            <option value="default">Default</option>
                            <option value="dark">Dark</option>
                            <option value="forest">Forest</option>
                            <option value="neutral">Neutral</option>
                        </select>
                    </div>

                    {config.type === "flowchart" && (
                        <div>
                            <label className="text-xs text-gray-400 uppercase">Direction</label>
                            <div className="mt-1 grid grid-cols-4 gap-1">
                                {(["TB", "LR", "BT", "RL"] as const).map(dir => (
                                    <button
                                        key={dir}
                                        className={`px-2 py-1 rounded text-xs ${config.direction === dir ? "bg-blue-600" : "bg-gray-800"
                                            }`}
                                        onClick={() => setConfig(c => ({ ...c, direction: dir }))}
                                    >
                                        {dir}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                {/* Code Editor */}
                <div className="flex-1 flex flex-col overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-2 bg-gray-800">
                        <span className="text-xs text-gray-400">Mermaid Code</span>
                        <button
                            onClick={copyCode}
                            className="text-xs text-blue-400 hover:text-blue-300"
                        >
                            Copy
                        </button>
                    </div>
                    <textarea
                        value={config.code}
                        onChange={(e) => setConfig(c => ({ ...c, code: e.target.value }))}
                        className="flex-1 p-4 bg-gray-900 font-mono text-sm text-green-400 resize-none outline-none"
                        spellCheck={false}
                    />
                </div>

                {/* Export */}
                <div className="p-4 border-t border-gray-700">
                    <button
                        onClick={exportSvg}
                        className="w-full px-4 py-2 bg-green-600 hover:bg-green-700 rounded font-medium"
                    >
                        📥 Export SVG
                    </button>
                </div>
            </div>

            {/* Preview */}
            <div className="flex-1 flex flex-col">
                <div className="px-4 py-2 bg-gray-800 border-b border-gray-700 flex items-center justify-between">
                    <span className="text-sm font-medium">Preview</span>
                    <div className="flex items-center gap-4">
                        <button
                            onClick={renderDiagram}
                            className="text-sm text-blue-400 hover:text-blue-300"
                        >
                            🔄 Refresh
                        </button>
                    </div>
                </div>

                <div
                    ref={previewRef}
                    className="flex-1 overflow-auto p-8 flex items-center justify-center"
                    style={{
                        background: config.theme === "dark"
                            ? "linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)"
                            : "#ffffff",
                    }}
                >
                    {error ? (
                        <div className="text-red-400 text-center">
                            <div className="text-4xl mb-2">⚠️</div>
                            <div>{error}</div>
                        </div>
                    ) : (
                        <div
                            dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(rendered, { USE_PROFILES: { svg: true } }) }}
                            className="max-w-full max-h-full"
                        />
                    )}
                </div>
            </div>
        </div>
    );
}

// ======== Mock SVG Generator ========

function generateMockSvg(config: DiagramConfig): string {
    const { type, theme } = config;
    const bgColor = theme === "dark" ? "#1e1e2e" : "#ffffff";
    const textColor = theme === "dark" ? "#cdd6f4" : "#1e1e2e";
    const primaryColor = theme === "forest" ? "#2d6a4f" : "#6366f1";

    const shapes: Record<DiagramType, string> = {
        flowchart: `
      <rect x="80" y="20" width="100" height="40" rx="5" fill="${primaryColor}"/>
      <text x="130" y="45" text-anchor="middle" fill="white" font-size="14">Start</text>
      <path d="M130 60 L130 100" stroke="${primaryColor}" stroke-width="2" marker-end="url(#arrow)"/>
      <polygon points="130,100 80,140 180,140" fill="${primaryColor}" opacity="0.7"/>
      <text x="130" y="128" text-anchor="middle" fill="white" font-size="12">Decision?</text>
      <path d="M80 140 L40 180" stroke="${primaryColor}" stroke-width="2" marker-end="url(#arrow)"/>
      <path d="M180 140 L220 180" stroke="${primaryColor}" stroke-width="2" marker-end="url(#arrow)"/>
      <rect x="10" y="180" width="60" height="30" rx="5" fill="${primaryColor}" opacity="0.8"/>
      <text x="40" y="200" text-anchor="middle" fill="white" font-size="10">Process A</text>
      <rect x="190" y="180" width="60" height="30" rx="5" fill="${primaryColor}" opacity="0.8"/>
      <text x="220" y="200" text-anchor="middle" fill="white" font-size="10">Process B</text>
    `,
        sequence: `
      <rect x="40" y="30" width="60" height="30" rx="5" fill="${primaryColor}"/>
      <text x="70" y="50" text-anchor="middle" fill="white" font-size="12">User</text>
      <line x1="70" y1="60" x2="70" y2="200" stroke="${primaryColor}" stroke-dasharray="4"/>
      <rect x="130" y="30" width="60" height="30" rx="5" fill="${primaryColor}"/>
      <text x="160" y="50" text-anchor="middle" fill="white" font-size="12">API</text>
      <line x1="160" y1="60" x2="160" y2="200" stroke="${primaryColor}" stroke-dasharray="4"/>
      <rect x="220" y="30" width="60" height="30" rx="5" fill="${primaryColor}"/>
      <text x="250" y="50" text-anchor="middle" fill="white" font-size="12">DB</text>
      <line x1="250" y1="60" x2="250" y2="200" stroke="${primaryColor}" stroke-dasharray="4"/>
      <path d="M70 90 L160 90" stroke="${textColor}" stroke-width="2" marker-end="url(#arrow)"/>
      <text x="115" y="85" text-anchor="middle" fill="${textColor}" font-size="10">Request</text>
    `,
        class: `
      <rect x="80" y="30" width="120" height="80" rx="5" fill="${primaryColor}" stroke="${textColor}"/>
      <line x1="80" y1="55" x2="200" y2="55" stroke="${textColor}"/>
      <text x="140" y="48" text-anchor="middle" fill="white" font-weight="bold" font-size="12">User</text>
      <text x="90" y="72" fill="white" font-size="10">+id: String</text>
      <text x="90" y="86" fill="white" font-size="10">+name: String</text>
      <text x="90" y="100" fill="white" font-size="10">+login()</text>
    `,
        erd: `
      <rect x="40" y="40" width="100" height="70" rx="5" fill="${primaryColor}"/>
      <text x="90" y="60" text-anchor="middle" fill="white" font-weight="bold">USER</text>
      <text x="50" y="80" fill="white" font-size="10">🔑 id</text>
      <text x="50" y="95" fill="white" font-size="10">email</text>
      <rect x="180" y="40" width="100" height="70" rx="5" fill="${primaryColor}"/>
      <text x="230" y="60" text-anchor="middle" fill="white" font-weight="bold">CHAT</text>
      <line x1="140" y1="75" x2="180" y2="75" stroke="${textColor}" stroke-width="2"/>
      <text x="160" y="70" text-anchor="middle" fill="${textColor}" font-size="10">1:N</text>
    `,
        mindmap: `
      <ellipse cx="150" cy="100" rx="60" ry="30" fill="${primaryColor}"/>
      <text x="150" y="105" text-anchor="middle" fill="white" font-weight="bold">ILIAGPT</text>
      <line x1="90" y1="100" x2="50" y2="60" stroke="${primaryColor}" stroke-width="2"/>
      <rect x="10" y="45" width="80" height="25" rx="12" fill="${primaryColor}" opacity="0.7"/>
      <text x="50" y="62" text-anchor="middle" fill="white" font-size="10">Features</text>
      <line x1="210" y1="100" x2="250" y2="60" stroke="${primaryColor}" stroke-width="2"/>
      <rect x="210" y="45" width="80" height="25" rx="12" fill="${primaryColor}" opacity="0.7"/>
      <text x="250" y="62" text-anchor="middle" fill="white" font-size="10">Technology</text>
    `,
    };

    return `
    <svg viewBox="0 0 300 220" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="${textColor}"/>
        </marker>
      </defs>
      <rect width="100%" height="100%" fill="${bgColor}"/>
      ${shapes[type]}
    </svg>
  `;
}

export default DiagramGenerator;
