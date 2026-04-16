import { memo } from "react";
import { Terminal, Globe, FileText, Code, Wrench } from "lucide-react";

interface ToolCallBadgeProps {
  tools: Array<{ id: string; name: string; durationMs?: number }>;
}

const toolIcons: Record<string, typeof Terminal> = {
  openclaw_exec: Terminal,
  openclaw_read: FileText,
  openclaw_write: FileText,
  web_search: Globe,
  code_eval: Code,
  default: Wrench,
};

export const ToolCallBadge = memo(function ToolCallBadge({ tools }: ToolCallBadgeProps) {
  if (!tools.length) return null;
  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {tools.map((tool, i) => {
        const Icon = toolIcons[tool.id] || toolIcons.default;
        return (
          <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-muted text-muted-foreground">
            <Icon size={10} />
            {tool.name}
            {tool.durationMs != null && <span className="opacity-60">{tool.durationMs}ms</span>}
          </span>
        );
      })}
    </div>
  );
});
