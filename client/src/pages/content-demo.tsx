/**
 * Content Format Layer Demo Page
 * 
 * Showcases all block types and features.
 */

import React, { useState } from 'react';
import { BlockRenderer, parseContent, getParseMetrics } from '@/lib/content';
import type { ContentBlock } from '@/lib/content';

// Demo content showcasing all features
const DEMO_MARKDOWN = `
# 🚀 Content Format Layer Demo

This demonstrates the **enterprise-grade** content rendering system.

---

## Syntax Highlighting (20+ languages)

\`\`\`typescript filename="example.ts" {2-4}
interface User {
  id: string;
  name: string;
  email: string;
}

function greet(user: User): string {
  return \`Hello, \${user.name}!\`;
}
\`\`\`

\`\`\`python filename="ml_model.py"
import torch
import torch.nn as nn

class NeuralNetwork(nn.Module):
    def __init__(self):
        super().__init__()
        self.linear = nn.Linear(784, 10)
    
    def forward(self, x):
        return self.linear(x)
\`\`\`

---

## Terminal Commands

\`\`\`bash
# Install dependencies
npm install prismjs katex react-virtuoso

# Run development server
npm run dev -- --port 5050
\`\`\`

---

## Tables

| Feature | Status | Priority |
|---------|--------|----------|
| Syntax Highlighting | ✅ Complete | High |
| KaTeX Math | ✅ Complete | Medium |
| Streaming | ✅ Complete | High |
| Virtualization | 🔄 In Progress | Low |

---

## Lists

1. **Ordered lists** with proper numbering
2. Nested items supported
3. Checkbox support:
   - [x] Completed task
   - [ ] Pending task

---

## Callouts (GitHub Style)

> [!NOTE]
> This is a helpful note with additional context.

> [!WARNING]
> Be careful with this operation!

> [!TIP]
> Pro tip: Use keyboard shortcuts for faster navigation.

---

## Images

![Demo Image](https://images.unsplash.com/photo-1517694712202-14dd9538aa97?w=800)

---

## Blockquotes

> "The best way to predict the future is to invent it."
> 
> — Alan Kay

---

## Inline Elements

This is **bold**, *italic*, \`inline code\`, and [a link](https://example.com).
`;

const DEMO_JSON_BLOCKS: ContentBlock[] = [
    {
        id: 'card-1',
        type: 'card',
        title: 'Enterprise Card',
        subtitle: 'Premium Feature',
        description: 'This is a structured card block rendered from JSON.',
        variant: 'elevated',
        actions: [
            { label: 'Learn More', action: 'learn', variant: 'primary' },
            { label: 'Dismiss', action: 'dismiss', variant: 'ghost' },
        ],
    },
    {
        id: 'callout-1',
        type: 'callout',
        variant: 'success',
        title: 'Success!',
        children: [
            { id: 'text-1', type: 'text', value: 'Operation completed successfully.' },
        ],
    },
    {
        id: 'button-1',
        type: 'button',
        label: 'Download Report',
        action: 'https://example.com/report.pdf',
        actionType: 'download',
        variant: 'primary',
        size: 'lg',
    },
];

export default function ContentDemoPage() {
    const [theme, setTheme] = useState<'light' | 'dark'>('dark');
    const [showDebug, setShowDebug] = useState(false);
    const [activeTab, setActiveTab] = useState<'markdown' | 'json'>('markdown');

    const metrics = getParseMetrics();

    return (
        <div
            className="min-h-screen p-8"
            style={{
                backgroundColor: theme === 'dark' ? '#0f172a' : '#ffffff',
                color: theme === 'dark' ? '#f8fafc' : '#0f172a',
            }}
        >
            {/* Header */}
            <div className="max-w-4xl mx-auto mb-8">
                <div className="flex items-center justify-between mb-6">
                    <h1 className="text-3xl font-bold">
                        📄 Content Format Layer
                    </h1>
                    <div className="flex items-center gap-4">
                        <button
                            onClick={() => setShowDebug(!showDebug)}
                            className={`px-3 py-1.5 rounded-lg text-sm ${showDebug ? 'bg-green-500/20 text-green-400' : 'bg-white/10'
                                }`}
                        >
                            {showDebug ? '🐛 Debug ON' : '🐛 Debug'}
                        </button>
                        <button
                            onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
                            className="px-3 py-1.5 rounded-lg text-sm bg-white/10 hover:bg-white/20"
                        >
                            {theme === 'dark' ? '☀️ Light' : '🌙 Dark'}
                        </button>
                    </div>
                </div>

                {/* Metrics */}
                <div className="grid grid-cols-3 gap-4 mb-6">
                    <div className="p-4 rounded-lg bg-white/5 border border-white/10">
                        <div className="text-2xl font-bold text-blue-400">{metrics.totalParses}</div>
                        <div className="text-sm opacity-60">Total Parses</div>
                    </div>
                    <div className="p-4 rounded-lg bg-white/5 border border-white/10">
                        <div className="text-2xl font-bold text-green-400">
                            {(metrics.cacheHitRate * 100).toFixed(0)}%
                        </div>
                        <div className="text-sm opacity-60">Cache Hit Rate</div>
                    </div>
                    <div className="p-4 rounded-lg bg-white/5 border border-white/10">
                        <div className="text-2xl font-bold text-purple-400">
                            {metrics.avgParseTime.toFixed(1)}ms
                        </div>
                        <div className="text-sm opacity-60">Avg Parse Time</div>
                    </div>
                </div>

                {/* Tabs */}
                <div className="flex gap-2 mb-6">
                    <button
                        onClick={() => setActiveTab('markdown')}
                        className={`px-4 py-2 rounded-lg text-sm font-medium ${activeTab === 'markdown'
                                ? 'bg-blue-500 text-white'
                                : 'bg-white/10 hover:bg-white/20'
                            }`}
                    >
                        📝 Markdown Demo
                    </button>
                    <button
                        onClick={() => setActiveTab('json')}
                        className={`px-4 py-2 rounded-lg text-sm font-medium ${activeTab === 'json'
                                ? 'bg-blue-500 text-white'
                                : 'bg-white/10 hover:bg-white/20'
                            }`}
                    >
                        📦 JSON Blocks Demo
                    </button>
                </div>
            </div>

            {/* Content */}
            <div className="max-w-4xl mx-auto">
                <div
                    className="rounded-2xl border p-8"
                    style={{
                        backgroundColor: theme === 'dark' ? '#1e293b' : '#f8fafc',
                        borderColor: theme === 'dark' ? '#334155' : '#e2e8f0',
                    }}
                >
                    {activeTab === 'markdown' ? (
                        <BlockRenderer
                            content={DEMO_MARKDOWN}
                            theme={theme}
                            debug={showDebug}
                        />
                    ) : (
                        <BlockRenderer
                            blocks={DEMO_JSON_BLOCKS}
                            theme={theme}
                            debug={showDebug}
                        />
                    )}
                </div>
            </div>
        </div>
    );
}
