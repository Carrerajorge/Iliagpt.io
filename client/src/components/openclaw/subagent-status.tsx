import { memo, useState, useEffect } from "react";
import { Loader2, CheckCircle2, XCircle, Circle } from "lucide-react";

interface SubagentRun {
  id: string;
  objective: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  startedAt?: number;
  completedAt?: number;
}

export const SubagentStatus = memo(function SubagentStatus({ chatId }: { chatId?: string }) {
  const [runs, setRuns] = useState<SubagentRun[]>([]);

  useEffect(() => {
    if (!chatId) return;
    const interval = setInterval(() => {
      fetch(`/api/openclaw/subagents?chatId=${chatId}`).then(r => r.json()).then(setRuns).catch(() => {});
    }, 3000);
    return () => clearInterval(interval);
  }, [chatId]);

  if (!runs.length) return null;

  const statusIcon = {
    queued: <Circle size={12} className="text-muted-foreground" />,
    running: <Loader2 size={12} className="text-blue-500 animate-spin" />,
    completed: <CheckCircle2 size={12} className="text-green-500" />,
    failed: <XCircle size={12} className="text-red-500" />,
    cancelled: <XCircle size={12} className="text-yellow-500" />,
  };

  return (
    <div className="px-3 py-2 border-t text-xs space-y-1">
      <div className="font-medium text-muted-foreground">Subagents</div>
      {runs.slice(0, 5).map(run => (
        <div key={run.id} className="flex items-center gap-2">
          {statusIcon[run.status]}
          <span className="truncate">{run.objective.slice(0, 60)}</span>
        </div>
      ))}
    </div>
  );
});
