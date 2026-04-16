import { AgentStep } from "@/hooks/use-agent";

interface AgentObserverProps {
  steps: AgentStep[];
  objective?: string;
  status: "idle" | "running" | "completed" | "failed" | "cancelled";
  onCancel?: () => void;
}

export function AgentObserver(_props: AgentObserverProps) {
  return null;
}
