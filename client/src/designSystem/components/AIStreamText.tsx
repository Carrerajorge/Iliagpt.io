import React, {
  useState,
  useCallback,
  useRef,
  useEffect,
  useMemo,
} from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AIStreamTextProps {
  /** Full markdown content string to render */
  content: string;
  /** When true, shows a blinking cursor at the end of the content */
  isStreaming?: boolean;
  /** Called with the copied text when user clicks copy */
  onCopy?: (text: string) => void;
  /** Extra CSS classes on the root element */
  className?: string;
}

interface ParsedBlock {
  type:
    | "paragraph"
    | "heading"
    | "code"
    | "blockquote"
    | "unordered-list"
    | "ordered-list"
    | "horizontal-rule"
    | "blank";
  content: string;
  level?: number;     // For headings: 1-6
  language?: string;  // For code blocks
  items?: string[];   // For lists
}

// ---------------------------------------------------------------------------
// Clipboard utility (no execCommand)
// ---------------------------------------------------------------------------

async function copyToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Markdown parser (lightweight, no external deps)
// ---------------------------------------------------------------------------

function parseInline(text: string): React.ReactNode[] {
  const result: React.ReactNode[] = [];
  const pattern =
    /(\*\*(.+?)\*\*)|(\*(.+?)\*)|(`(.+?)`)|~~(.+?)~~|\[([^\]]+)\]\(([^)]+)\)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      result.push(text.slice(lastIndex, match.index));
    }

    if (match[1]) {
      result.push(
        <strong key={match.index} className="font-semibold text-white">
          {match[2]}
        </strong>
      );
    } else if (match[3]) {
      result.push(
        <em key={match.index} className="italic text-gray-200">
          {match[4]}
        </em>
      );
    } else if (match[5]) {
      result.push(
        <code
          key={match.index}
          className="px-1.5 py-0.5 rounded bg-purple-950/60 text-purple-300 font-mono text-[0.8125rem] border border-purple-800/30"
        >
          {match[6]}
        </code>
      );
    } else if (match[7]) {
      result.push(
        <del key={match.index} className="line-through text-gray-500">
          {match[7]}
        </del>
      );
    } else if (match[8]) {
      result.push(
        <a
          key={match.index}
          href={match[9]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-400 hover:text-blue-300 underline underline-offset-2 transition-colors"
        >
          {match[8]}
        </a>
      );
    }

    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) {
    result.push(text.slice(lastIndex));
  }

  return result;
}

function parseMarkdown(markdown: string): ParsedBlock[] {
  const lines = markdown.split("\n");
  const blocks: ParsedBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    if (/^```(\w*)/.test(line)) {
      const langMatch = line.match(/^```(\w*)/);
      const language = langMatch?.[1] ?? "";
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        codeLines.push(lines[i]);
        i++;
      }
      blocks.push({ type: "code", content: codeLines.join("\n"), language });
      i++;
      continue;
    }

    // Heading
    const headingMatch = line.match(/^(#{1,6})\s+(.*)/);
    if (headingMatch) {
      blocks.push({
        type: "heading",
        level: headingMatch[1].length,
        content: headingMatch[2],
      });
      i++;
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push({ type: "horizontal-rule", content: "" });
      i++;
      continue;
    }

    // Blockquote
    if (line.startsWith("> ")) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].startsWith("> ")) {
        quoteLines.push(lines[i].slice(2));
        i++;
      }
      blocks.push({ type: "blockquote", content: quoteLines.join("\n") });
      continue;
    }

    // Unordered list
    if (/^[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*+]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^[-*+]\s+/, ""));
        i++;
      }
      blocks.push({ type: "unordered-list", content: "", items });
      continue;
    }

    // Ordered list
    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s+/, ""));
        i++;
      }
      blocks.push({ type: "ordered-list", content: "", items });
      continue;
    }

    // Blank line
    if (line.trim() === "") {
      blocks.push({ type: "blank", content: "" });
      i++;
      continue;
    }

    // Paragraph
    const paragraphLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^(#{1,6}\s|```|> |\d+\. |[-*+] |---|\*\*\*|___)\s*/.test(lines[i])
    ) {
      paragraphLines.push(lines[i]);
      i++;
    }
    if (paragraphLines.length > 0) {
      blocks.push({ type: "paragraph", content: paragraphLines.join(" ") });
    }
  }

  return blocks;
}

// ---------------------------------------------------------------------------
// Code block sub-component
// ---------------------------------------------------------------------------

interface CodeBlockProps {
  code: string;
  language: string;
  onCopy?: (text: string) => void;
}

function CodeBlock({ code, language, onCopy }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    const ok = await copyToClipboard(code);
    if (ok) {
      setCopied(true);
      onCopy?.(code);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [code, onCopy]);

  return (
    <div className="relative my-4 rounded-lg overflow-hidden border border-gray-700/60 bg-[#0a0e16] group">
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 py-2 bg-gray-900/80 border-b border-gray-700/60">
        <div className="flex items-center gap-2">
          <div className="flex gap-1.5">
            <div className="w-3 h-3 rounded-full bg-red-500/70" />
            <div className="w-3 h-3 rounded-full bg-amber-500/70" />
            <div className="w-3 h-3 rounded-full bg-green-500/70" />
          </div>
          {language && (
            <span className="text-xs font-mono text-gray-400 font-medium ml-2 uppercase tracking-wider">
              {language}
            </span>
          )}
        </div>

        <button
          onClick={handleCopy}
          aria-label={copied ? "Copied!" : "Copy code"}
          className={[
            "flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md font-medium transition-all duration-200",
            copied
              ? "text-green-400 bg-green-900/30 border border-green-700/50"
              : "text-gray-400 hover:text-gray-200 bg-gray-800/60 hover:bg-gray-700/60 border border-gray-700/40",
          ].join(" ")}
        >
          {copied ? (
            <>
              <CheckIcon className="w-3.5 h-3.5" />
              Copied
            </>
          ) : (
            <>
              <CopyIcon className="w-3.5 h-3.5" />
              Copy
            </>
          )}
        </button>
      </div>

      {/* Code content */}
      <pre className="overflow-x-auto p-4 text-sm font-mono leading-7 text-gray-200">
        <code>{code}</code>
      </pre>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Icon helpers
// ---------------------------------------------------------------------------

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  );
}

function CopyIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Streaming cursor
// ---------------------------------------------------------------------------

function StreamingCursor() {
  return (
    <span
      aria-hidden="true"
      className="inline-block w-0.5 h-4 bg-purple-400 ml-0.5 align-middle animate-pulse"
      style={{ animationDuration: "0.8s" }}
    />
  );
}

// ---------------------------------------------------------------------------
// Block renderer
// ---------------------------------------------------------------------------

function renderBlock(
  block: ParsedBlock,
  index: number,
  onCopy?: (text: string) => void
): React.ReactNode {
  switch (block.type) {
    case "heading": {
      const level = block.level ?? 1;
      const sizeMap: Record<number, string> = {
        1: "text-2xl font-bold text-white mt-6 mb-3",
        2: "text-xl font-bold text-white mt-5 mb-2",
        3: "text-lg font-semibold text-white mt-4 mb-2",
        4: "text-base font-semibold text-gray-100 mt-4 mb-1.5",
        5: "text-sm font-semibold text-gray-200 mt-3 mb-1",
        6: "text-xs font-semibold text-gray-300 uppercase tracking-wide mt-3 mb-1",
      };
      const Tag = `h${level}` as keyof JSX.IntrinsicElements;
      return (
        <Tag key={index} className={sizeMap[level]}>
          {parseInline(block.content)}
        </Tag>
      );
    }

    case "code":
      return (
        <CodeBlock
          key={index}
          code={block.content}
          language={block.language ?? ""}
          onCopy={onCopy}
        />
      );

    case "blockquote":
      return (
        <blockquote
          key={index}
          className="my-3 pl-4 border-l-4 border-purple-500/60 bg-purple-950/20 py-2 pr-3 rounded-r-md text-gray-300 italic"
        >
          {parseInline(block.content)}
        </blockquote>
      );

    case "unordered-list":
      return (
        <ul key={index} className="my-3 ml-4 space-y-1.5 list-none">
          {block.items?.map((item, i) => (
            <li key={i} className="flex items-start gap-2 text-gray-200">
              <span className="mt-2.5 w-1.5 h-1.5 rounded-full bg-purple-400 flex-shrink-0" />
              <span>{parseInline(item)}</span>
            </li>
          ))}
        </ul>
      );

    case "ordered-list":
      return (
        <ol key={index} className="my-3 ml-4 space-y-1.5 list-none">
          {block.items?.map((item, i) => (
            <li key={i} className="flex items-start gap-2.5 text-gray-200">
              <span className="flex-shrink-0 w-5 h-5 rounded-full bg-purple-900/60 border border-purple-700/40 text-purple-300 text-xs flex items-center justify-center font-medium mt-0.5">
                {i + 1}
              </span>
              <span>{parseInline(item)}</span>
            </li>
          ))}
        </ol>
      );

    case "horizontal-rule":
      return <hr key={index} className="my-4 border-gray-700/60" />;

    case "blank":
      return null;

    case "paragraph":
    default:
      return (
        <p key={index} className="my-2 text-gray-200 leading-7">
          {parseInline(block.content)}
        </p>
      );
  }
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function AIStreamText({
  content,
  isStreaming = false,
  onCopy,
  className = "",
}: AIStreamTextProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [globalCopied, setGlobalCopied] = useState(false);

  const blocks = useMemo(() => parseMarkdown(content), [content]);

  // Auto-scroll to bottom while streaming
  useEffect(() => {
    if (isStreaming && containerRef.current) {
      const el = containerRef.current;
      el.scrollTop = el.scrollHeight;
    }
  }, [content, isStreaming]);

  const handleGlobalCopy = useCallback(async () => {
    const ok = await copyToClipboard(content);
    if (ok) {
      setGlobalCopied(true);
      onCopy?.(content);
      setTimeout(() => setGlobalCopied(false), 2000);
    }
  }, [content, onCopy]);

  const isLastBlockCode =
    blocks.length > 0 && blocks[blocks.length - 1].type === "code";

  return (
    <div className={`relative group ${className}`}>
      {/* Copy all button */}
      {!isStreaming && content.length > 0 && (
        <button
          onClick={handleGlobalCopy}
          aria-label={globalCopied ? "Copied!" : "Copy entire response"}
          className={[
            "absolute top-0 right-0 z-10",
            "flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md font-medium",
            "opacity-0 group-hover:opacity-100 transition-all duration-200",
            globalCopied
              ? "text-green-400 bg-green-900/30 border border-green-700/50"
              : "text-gray-400 hover:text-gray-200 bg-gray-800 border border-gray-700",
          ].join(" ")}
        >
          {globalCopied ? (
            <>
              <CheckIcon className="w-3.5 h-3.5" />
              Copied
            </>
          ) : (
            <>
              <CopyIcon className="w-3.5 h-3.5" />
              Copy all
            </>
          )}
        </button>
      )}

      {/* Rendered markdown */}
      <div
        ref={containerRef}
        className="text-[0.9375rem] text-gray-200 leading-7"
      >
        {blocks.map((block, i) => {
          const isLastBlock = i === blocks.length - 1;
          const rendered = renderBlock(block, i, onCopy);

          if (isStreaming && isLastBlock && !isLastBlockCode) {
            if (block.type === "paragraph") {
              return (
                <p key={i} className="my-2 text-gray-200 leading-7">
                  {parseInline(block.content)}
                  <StreamingCursor />
                </p>
              );
            }
          }

          return rendered;
        })}

        {isStreaming && (isLastBlockCode || blocks.length === 0) && (
          <StreamingCursor />
        )}
      </div>
    </div>
  );
}

export default AIStreamText;
