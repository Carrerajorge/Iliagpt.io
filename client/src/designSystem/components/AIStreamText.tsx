import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
} from 'react';
import ReactMarkdown from 'react-markdown';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AIStreamTextProps {
  text: string;
  isStreaming?: boolean;
  showCursor?: boolean;
  onComplete?: () => void;
  className?: string;
}

interface CodeBlockProps {
  children?: React.ReactNode;
  className?: string;
  inline?: boolean;
}

// ---------------------------------------------------------------------------
// Token / word counter
// ---------------------------------------------------------------------------

function approximateTokenCount(text: string): number {
  // Rough approximation: ~0.75 tokens per word
  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.ceil(wordCount * 0.75);
}

// ---------------------------------------------------------------------------
// Copy button
// ---------------------------------------------------------------------------

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers
      const el = document.createElement('textarea');
      el.value = text;
      el.style.position = 'fixed';
      el.style.opacity = '0';
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [text]);

  return (
    <button
      onClick={handleCopy}
      className={cn(
        'absolute top-2 right-2 p-1.5 rounded-md',
        'bg-white/10 hover:bg-white/20 transition-colors',
        'text-slate-300 hover:text-white',
        'flex items-center gap-1 text-xs font-medium',
      )}
      aria-label={copied ? 'Copied!' : 'Copy code'}
      title={copied ? 'Copied!' : 'Copy'}
    >
      <AnimatePresence mode="wait" initial={false}>
        {copied ? (
          <motion.span
            key="check"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            className="flex items-center gap-1"
          >
            <Check size={12} className="text-emerald-400" />
            <span className="text-emerald-400">Copied!</span>
          </motion.span>
        ) : (
          <motion.span
            key="copy"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            className="flex items-center gap-1"
          >
            <Copy size={12} />
          </motion.span>
        )}
      </AnimatePresence>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Code block renderer
// ---------------------------------------------------------------------------

function CodeBlock({ children, className, inline }: CodeBlockProps) {
  const rawText = String(children ?? '').replace(/\n$/, '');
  const language = className?.replace('language-', '') ?? 'text';

  if (inline) {
    return (
      <code className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 text-[0.875em] font-mono">
        {children}
      </code>
    );
  }

  return (
    <div className="relative group my-4 rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700">
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 py-2 bg-slate-800 dark:bg-slate-900 border-b border-slate-700">
        <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">
          {language}
        </span>
        <CopyButton text={rawText} />
      </div>

      {/* Code body – show first 200 lines max with expand */}
      <pre className="overflow-x-auto p-4 bg-slate-900 dark:bg-slate-950 text-sm font-mono text-slate-200 leading-relaxed">
        <code className={className}>{children}</code>
      </pre>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Blinking cursor
// ---------------------------------------------------------------------------

function StreamingCursor() {
  return (
    <motion.span
      className="inline-block w-[2px] h-[1.1em] bg-current align-text-bottom ml-0.5 rounded-sm"
      animate={{ opacity: [1, 0, 1] }}
      transition={{ duration: 0.8, repeat: Infinity, ease: 'easeInOut' }}
      aria-hidden="true"
    />
  );
}

// ---------------------------------------------------------------------------
// Token badge
// ---------------------------------------------------------------------------

function TokenBadge({ tokenCount }: { tokenCount: number }) {
  return (
    <motion.span
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      className={cn(
        'inline-flex items-center gap-1 ml-2 px-1.5 py-0.5 rounded-full',
        'text-[10px] font-medium',
        'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400',
        'border border-slate-200 dark:border-slate-700',
        'select-none',
      )}
      title="Approximate token count"
    >
      ~{tokenCount.toLocaleString()} tokens
    </motion.span>
  );
}

// ---------------------------------------------------------------------------
// Word-by-word fade animation (for completed text)
// ---------------------------------------------------------------------------

function AnimatedWords({ text, className }: { text: string; className?: string }) {
  const words = useMemo(() => text.split(/(\s+)/), [text]);

  return (
    <span className={className}>
      {words.map((word, i) => (
        <motion.span
          key={i}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: Math.min(i * 0.008, 0.5), duration: 0.15 }}
        >
          {word}
        </motion.span>
      ))}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Markdown component map
// ---------------------------------------------------------------------------

function buildComponents(isStreaming: boolean) {
  return {
    code: ({ className, children, ...props }: React.HTMLAttributes<HTMLElement> & { inline?: boolean }) => {
      const isInline = props.inline ?? !className;
      return (
        <CodeBlock className={className} inline={isInline}>
          {children}
        </CodeBlock>
      );
    },
    p: ({ children }: React.HTMLAttributes<HTMLParagraphElement>) => {
      if (!isStreaming) {
        return (
          <motion.p
            className="mb-3 last:mb-0 leading-relaxed"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
          >
            {children}
          </motion.p>
        );
      }
      return <p className="mb-3 last:mb-0 leading-relaxed">{children}</p>;
    },
    h1: ({ children }: React.HTMLAttributes<HTMLHeadingElement>) => (
      <h1 className="text-2xl font-bold mb-4 mt-6 first:mt-0">{children}</h1>
    ),
    h2: ({ children }: React.HTMLAttributes<HTMLHeadingElement>) => (
      <h2 className="text-xl font-semibold mb-3 mt-5 first:mt-0">{children}</h2>
    ),
    h3: ({ children }: React.HTMLAttributes<HTMLHeadingElement>) => (
      <h3 className="text-lg font-semibold mb-2 mt-4 first:mt-0">{children}</h3>
    ),
    ul: ({ children }: React.HTMLAttributes<HTMLUListElement>) => (
      <ul className="list-disc pl-6 mb-3 space-y-1">{children}</ul>
    ),
    ol: ({ children }: React.HTMLAttributes<HTMLOListElement>) => (
      <ol className="list-decimal pl-6 mb-3 space-y-1">{children}</ol>
    ),
    li: ({ children }: React.HTMLAttributes<HTMLLIElement>) => (
      <li className="leading-relaxed">{children}</li>
    ),
    blockquote: ({ children }: React.HTMLAttributes<HTMLQuoteElement>) => (
      <blockquote className="border-l-4 border-indigo-400 dark:border-indigo-500 pl-4 py-1 my-3 text-slate-600 dark:text-slate-400 italic">
        {children}
      </blockquote>
    ),
    hr: () => <hr className="my-4 border-slate-200 dark:border-slate-700" />,
    strong: ({ children }: React.HTMLAttributes<HTMLElement>) => (
      <strong className="font-semibold text-slate-900 dark:text-slate-100">{children}</strong>
    ),
    em: ({ children }: React.HTMLAttributes<HTMLElement>) => (
      <em className="italic">{children}</em>
    ),
    a: ({ children, href }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-indigo-600 dark:text-indigo-400 hover:underline"
      >
        {children}
      </a>
    ),
    table: ({ children }: React.HTMLAttributes<HTMLTableElement>) => (
      <div className="overflow-x-auto my-4">
        <table className="min-w-full text-sm border-collapse border border-slate-200 dark:border-slate-700">
          {children}
        </table>
      </div>
    ),
    th: ({ children }: React.HTMLAttributes<HTMLTableCellElement>) => (
      <th className="px-4 py-2 bg-slate-100 dark:bg-slate-800 font-semibold border border-slate-200 dark:border-slate-700 text-left">
        {children}
      </th>
    ),
    td: ({ children }: React.HTMLAttributes<HTMLTableCellElement>) => (
      <td className="px-4 py-2 border border-slate-200 dark:border-slate-700">{children}</td>
    ),
  };
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function AIStreamText({
  text,
  isStreaming = false,
  showCursor = true,
  onComplete,
  className,
}: AIStreamTextProps) {
  const prevStreaming = useRef(isStreaming);
  const tokenCount = useMemo(() => approximateTokenCount(text), [text]);
  const components = useMemo(() => buildComponents(isStreaming), [isStreaming]);

  // Fire onComplete when streaming finishes
  useEffect(() => {
    if (prevStreaming.current && !isStreaming && onComplete) {
      onComplete();
    }
    prevStreaming.current = isStreaming;
  }, [isStreaming, onComplete]);

  const showBlinker = isStreaming && showCursor;

  return (
    <div
      className={cn(
        'relative text-slate-800 dark:text-slate-200',
        'prose prose-slate dark:prose-invert max-w-none',
        'prose-code:before:content-none prose-code:after:content-none',
        className,
      )}
    >
      <ReactMarkdown components={components as Record<string, React.ElementType>}>
        {text}
      </ReactMarkdown>

      {/* Blinking cursor appended at end during streaming */}
      {showBlinker && (
        <span className="inline-flex items-baseline">
          <StreamingCursor />
        </span>
      )}

      {/* Token count badge – only when not streaming */}
      {!isStreaming && text.length > 0 && (
        <div className="mt-2 flex items-center justify-end">
          <TokenBadge tokenCount={tokenCount} />
        </div>
      )}
    </div>
  );
}

export default AIStreamText;
