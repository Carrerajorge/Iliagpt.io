import React, { useState } from 'react';
import { ChevronRight, ChevronDown, Braces } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';

interface JsonArgumentsViewerProps {
    args: Record<string, any>;
    title?: string;
    defaultExpanded?: boolean;
    className?: string;
}

export function JsonArgumentsViewer({
    args,
    title = "Arguments",
    defaultExpanded = false,
    className
}: JsonArgumentsViewerProps) {
    const [isExpanded, setIsExpanded] = useState(defaultExpanded);
    const jsonString = JSON.stringify(args, null, 2);

    return (
        <div className={cn("rounded-md border border-neutral-800 bg-neutral-900/50 overflow-hidden text-sm", className)}>
            <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="w-full flex items-center gap-2 px-3 py-2 text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/50 transition-colors"
            >
                {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                <Braces className="w-3.5 h-3.5" />
                <span className="font-mono text-xs uppercase tracking-wider">{title}</span>
                <div className="ml-auto text-[10px] bg-neutral-800 px-1.5 py-0.5 rounded text-neutral-500 font-mono">
                    JSON
                </div>
            </button>

            {isExpanded && (
                <div className="border-t border-neutral-800">
                    <SyntaxHighlighter
                        language="json"
                        style={vscDarkPlus}
                        customStyle={{
                            margin: 0,
                            padding: '12px',
                            fontSize: '12px',
                            lineHeight: '1.5',
                            background: 'transparent',
                        }}
                        wrapLongLines={true}
                    >
                        {jsonString}
                    </SyntaxHighlighter>
                </div>
            )}
        </div>
    );
}
