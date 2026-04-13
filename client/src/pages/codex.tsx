import { CodexChat } from "@/components/codex/CodexChat";

export default function CodexPage() {
  return (
    <div className="h-screen w-screen overflow-hidden bg-background text-foreground">
      <CodexChat />
    </div>
  );
}
