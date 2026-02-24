/**
 * CodeBlock Pro Component
 * 
 * Enterprise-grade code rendering with:
 * - Prism.js syntax highlighting
 * - Line numbers with selection
 * - Copy with animation
 * - Collapsible with preview
 * - Diff mode
 * - Terminal mode
 * - Live edit mode
 */

import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import Prism from 'prismjs';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-jsx';
import 'prismjs/components/prism-tsx';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-css';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-sql';
import 'prismjs/components/prism-markdown';
import 'prismjs/components/prism-yaml';
import 'prismjs/components/prism-go';
import 'prismjs/components/prism-rust';
import 'prismjs/components/prism-java';
import 'prismjs/components/prism-csharp';
import 'prismjs/components/prism-php';
import 'prismjs/components/prism-ruby';
import 'prismjs/components/prism-swift';
import 'prismjs/components/prism-kotlin';
import 'prismjs/components/prism-diff';

import type { CodeBlock as CodeBlockType } from '../../types/blocks';
import type { RenderContext } from '../../types/content';
import { useContentTheme, useRenderContext } from '../../renderers/block-renderer';
import {
    Check, Copy, ChevronDown, ChevronRight, File, Terminal,
    Play, Maximize2, Minimize2, Download, ExternalLink
} from 'lucide-react';

// ============================================================================
// LANGUAGE MAPPINGS
// ============================================================================

const LANGUAGE_ALIASES: Record<string, string> = {
    'js': 'javascript',
    'ts': 'typescript',
    'py': 'python',
    'rb': 'ruby',
    'sh': 'bash',
    'shell': 'bash',
    'zsh': 'bash',
    'yml': 'yaml',
    'md': 'markdown',
    'cs': 'csharp',
    'kt': 'kotlin',
};

const LANGUAGE_LABELS: Record<string, string> = {
    'javascript': 'JavaScript',
    'typescript': 'TypeScript',
    'jsx': 'React JSX',
    'tsx': 'React TSX',
    'python': 'Python',
    'css': 'CSS',
    'json': 'JSON',
    'bash': 'Terminal',
    'sql': 'SQL',
    'markdown': 'Markdown',
    'yaml': 'YAML',
    'go': 'Go',
    'rust': 'Rust',
    'java': 'Java',
    'csharp': 'C#',
    'php': 'PHP',
    'ruby': 'Ruby',
    'swift': 'Swift',
    'kotlin': 'Kotlin',
    'diff': 'Diff',
};

// ============================================================================
// PRISM THEME TOKENS (One Dark)
// ============================================================================

const prismTheme = `
.token.comment,
.token.prolog,
.token.doctype,
.token.cdata { color: #5c6370; font-style: italic; }
.token.punctuation { color: #abb2bf; }
.token.property,
.token.tag,
.token.boolean,
.token.number,
.token.constant,
.token.symbol,
.token.deleted { color: #e06c75; }
.token.selector,
.token.attr-name,
.token.string,
.token.char,
.token.builtin,
.token.inserted { color: #98c379; }
.token.operator,
.token.entity,
.token.url,
.language-css .token.string,
.style .token.string { color: #56b6c2; }
.token.atrule,
.token.attr-value,
.token.keyword { color: #c678dd; }
.token.function,
.token.class-name { color: #61afef; }
.token.regex,
.token.important,
.token.variable { color: #d19a66; }

/* Diff additions/deletions */
.token.deleted { background: rgba(239, 68, 68, 0.2); }
.token.inserted { background: rgba(34, 197, 94, 0.2); }
`;

// ============================================================================
// PROPS
// ============================================================================

interface Props {
    block: CodeBlockType;
    context: RenderContext;
}

// ============================================================================
// COMPONENT
// ============================================================================

export default function CodeBlock({ block, context }: Props) {
    const theme = useContentTheme();
    const renderContext = useRenderContext();

    const [copied, setCopied] = useState(false);
    const [collapsed, setCollapsed] = useState(block.collapsed ?? false);
    const [expanded, setExpanded] = useState(false);
    const [selectedLines, setSelectedLines] = useState<Set<number>>(new Set());

    const codeRef = useRef<HTMLElement>(null);

    const {
        code,
        language: rawLang,
        filename,
        showLineNumbers = true,
        highlightLines = [],
        executable = false,
    } = block;

    // Normalize language
    const language = useMemo(() => {
        const lower = (rawLang || 'text').toLowerCase();
        return LANGUAGE_ALIASES[lower] || lower;
    }, [rawLang]);

    const languageLabel = LANGUAGE_LABELS[language] || language.toUpperCase();
    const isTerminal = language === 'bash' || language === 'shell';
    const isDiff = language === 'diff' || code.includes('@@') || code.match(/^[+-]/m);

    // Syntax highlighting
    const highlightedCode = useMemo(() => {
        try {
            if (Prism.languages[language]) {
                return Prism.highlight(code, Prism.languages[language], language);
            }
        } catch (e) {
            console.warn('[CodeBlock] Highlight error:', e);
        }
        return escapeHtml(code);
    }, [code, language]);

    const lines = useMemo(() => code.split('\n'), [code]);

    // Copy handler with animation
    const handleCopy = useCallback(async () => {
        try {
            await navigator.clipboard.writeText(code);
            setCopied(true);
            renderContext.handlers?.onCodeCopy?.(code);

            // Animate
            setTimeout(() => setCopied(false), 2000);
        } catch (e) {
            console.error('[CodeBlock] Copy failed:', e);
        }
    }, [code, renderContext.handlers]);

    // Line selection
    const handleLineClick = useCallback((lineNum: number, e: React.MouseEvent) => {
        if (e.shiftKey && selectedLines.size > 0) {
            // Range selection
            const sorted = Array.from(selectedLines).sort((a, b) => a - b);
            const start = Math.min(sorted[0], lineNum);
            const end = Math.max(sorted[sorted.length - 1], lineNum);
            const newSet = new Set<number>();
            for (let i = start; i <= end; i++) newSet.add(i);
            setSelectedLines(newSet);
        } else if (e.metaKey || e.ctrlKey) {
            // Toggle single
            const newSet = new Set(selectedLines);
            if (newSet.has(lineNum)) {
                newSet.delete(lineNum);
            } else {
                newSet.add(lineNum);
            }
            setSelectedLines(newSet);
        } else {
            // Single selection
            setSelectedLines(new Set([lineNum]));
        }
    }, [selectedLines]);

    // Download handler
    const handleDownload = useCallback(() => {
        const blob = new Blob([code], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename || `code.${language}`;
        a.click();
        URL.revokeObjectURL(url);
    }, [code, filename, language]);

    // Preview lines when collapsed
    const previewLines = 3;

    return (
        <>
            {/* Inject Prism theme */}
            <style dangerouslySetInnerHTML={{ __html: prismTheme }} />

            <div
                className={`my-4 rounded-xl overflow-hidden transition-all duration-200 ${expanded ? 'fixed inset-4 z-50' : 'relative'
                    }`}
                style={{
                    backgroundColor: '#1e1e2e',
                    boxShadow: expanded
                        ? '0 25px 50px -12px rgba(0, 0, 0, 0.5)'
                        : '0 4px 6px -1px rgba(0, 0, 0, 0.2)',
                    border: '1px solid #313244',
                }}
            >
                {/* Header */}
                <div
                    className="flex items-center justify-between px-4 py-2.5"
                    style={{
                        backgroundColor: '#181825',
                        borderBottom: '1px solid #313244',
                    }}
                >
                    {/* Left side */}
                    <div className="flex items-center gap-3">
                        {/* Collapse button */}
                        {block.collapsed !== undefined && (
                            <button
                                onClick={() => setCollapsed(!collapsed)}
                                className="p-1 rounded hover:bg-white/10 transition-colors"
                            >
                                {collapsed
                                    ? <ChevronRight size={16} className="text-gray-400" />
                                    : <ChevronDown size={16} className="text-gray-400" />
                                }
                            </button>
                        )}

                        {/* File icon */}
                        {isTerminal ? (
                            <Terminal size={16} className="text-green-400" />
                        ) : (
                            <File size={16} className="text-gray-400" />
                        )}

                        {/* Filename or language */}
                        <span className="text-sm font-medium text-gray-300">
                            {filename || languageLabel}
                        </span>

                        {/* Line count */}
                        <span className="text-xs text-gray-500">
                            {lines.length} líneas
                        </span>
                    </div>

                    {/* Right side - Actions */}
                    <div className="flex items-center gap-1">
                        {/* Executable indicator */}
                        {executable && (
                            <button
                                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-green-500/20 text-green-400 hover:bg-green-500/30 transition-colors"
                            >
                                <Play size={12} />
                                Ejecutar
                            </button>
                        )}

                        {/* Download */}
                        <button
                            onClick={handleDownload}
                            className="p-1.5 rounded-lg hover:bg-white/10 transition-colors text-gray-400 hover:text-gray-200"
                            title="Descargar"
                        >
                            <Download size={14} />
                        </button>

                        {/* Expand/Collapse */}
                        <button
                            onClick={() => setExpanded(!expanded)}
                            className="p-1.5 rounded-lg hover:bg-white/10 transition-colors text-gray-400 hover:text-gray-200"
                            title={expanded ? 'Minimizar' : 'Expandir'}
                        >
                            {expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                        </button>

                        {/* Copy button */}
                        <button
                            onClick={handleCopy}
                            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all ${copied
                                    ? 'bg-green-500/20 text-green-400'
                                    : 'bg-white/10 text-gray-300 hover:bg-white/20'
                                }`}
                        >
                            {copied ? (
                                <>
                                    <Check size={14} className="animate-bounce" />
                                    <span>¡Copiado!</span>
                                </>
                            ) : (
                                <>
                                    <Copy size={14} />
                                    <span>Copiar</span>
                                </>
                            )}
                        </button>
                    </div>
                </div>

                {/* Code content */}
                {!collapsed && (
                    <div
                        className="overflow-auto"
                        style={{
                            maxHeight: expanded ? 'calc(100vh - 120px)' : 400,
                            scrollbarWidth: 'thin',
                            scrollbarColor: '#45475a #1e1e2e',
                        }}
                    >
                        <pre
                            className="m-0 p-0"
                            style={{
                                fontFamily: '"JetBrains Mono", "Fira Code", Consolas, monospace',
                                fontSize: 13,
                                lineHeight: 1.6,
                                tabSize: 2,
                            }}
                        >
                            <code ref={codeRef} className={`language-${language}`}>
                                {lines.map((line, i) => {
                                    const lineNum = i + 1;
                                    const isHighlighted = highlightLines.includes(lineNum);
                                    const isSelected = selectedLines.has(lineNum);
                                    const isDiffAdd = line.startsWith('+') && isDiff;
                                    const isDiffRemove = line.startsWith('-') && isDiff;

                                    return (
                                        <div
                                            key={i}
                                            className="flex group"
                                            style={{
                                                backgroundColor: isSelected
                                                    ? 'rgba(137, 180, 250, 0.15)'
                                                    : isHighlighted
                                                        ? 'rgba(249, 226, 175, 0.1)'
                                                        : isDiffAdd
                                                            ? 'rgba(166, 227, 161, 0.1)'
                                                            : isDiffRemove
                                                                ? 'rgba(243, 139, 168, 0.1)'
                                                                : 'transparent',
                                                borderLeft: isHighlighted
                                                    ? '3px solid #f9e2af'
                                                    : '3px solid transparent',
                                            }}
                                            onClick={(e) => handleLineClick(lineNum, e)}
                                        >
                                            {/* Line number */}
                                            {showLineNumbers && (
                                                <span
                                                    className="select-none text-right pr-4 pl-4 cursor-pointer group-hover:text-gray-400"
                                                    style={{
                                                        minWidth: 50,
                                                        color: isSelected ? '#89b4fa' : '#6c7086',
                                                        backgroundColor: '#181825',
                                                    }}
                                                >
                                                    {lineNum}
                                                </span>
                                            )}

                                            {/* Code line */}
                                            <span
                                                className="flex-1 px-4"
                                                style={{ color: '#cdd6f4' }}
                                                dangerouslySetInnerHTML={{
                                                    __html: highlightLine(line, language) || '&nbsp;'
                                                }}
                                            />
                                        </div>
                                    );
                                })}
                            </code>
                        </pre>
                    </div>
                )}

                {/* Collapsed preview */}
                {collapsed && (
                    <div
                        className="px-4 py-3"
                        style={{ backgroundColor: '#1e1e2e', color: '#6c7086' }}
                    >
                        <pre className="text-xs opacity-60 line-clamp-3" style={{ margin: 0 }}>
                            {lines.slice(0, previewLines).join('\n')}
                            {lines.length > previewLines && '\n...'}
                        </pre>
                    </div>
                )}
            </div>

            {/* Fullscreen backdrop */}
            {expanded && (
                <div
                    className="fixed inset-0 bg-black/80 z-40"
                    onClick={() => setExpanded(false)}
                />
            )}
        </>
    );
}

// ============================================================================
// HELPERS
// ============================================================================

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function highlightLine(line: string, language: string): string {
    try {
        if (Prism.languages[language]) {
            return Prism.highlight(line, Prism.languages[language], language);
        }
    } catch (e) {
        // Fallback to escaped HTML
    }
    return escapeHtml(line);
}
