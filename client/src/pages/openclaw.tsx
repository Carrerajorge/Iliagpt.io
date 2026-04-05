import { useLocation } from "wouter";
import { ChevronLeft } from "lucide-react";

export default function OpenClawPage() {
  const [, setLocation] = useLocation();

  return (
    <div className="flex flex-col h-screen bg-background" data-testid="openclaw-page">
      <div className="flex items-center gap-2 px-3 py-2 border-b bg-background shrink-0">
        <button
          onClick={() => setLocation("/")}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          data-testid="button-back-to-app"
        >
          <ChevronLeft className="h-4 w-4" />
          <span>IliaGPT</span>
        </button>
        <span className="text-muted-foreground/50">›</span>
        <span className="text-sm font-medium">OpenClaw</span>
      </div>
      <iframe
        src="/openclaw-boot"
        className="flex-1 w-full border-0"
        title="OpenClaw Control UI"
        data-testid="iframe-openclaw"
      />
    </div>
  );
}
