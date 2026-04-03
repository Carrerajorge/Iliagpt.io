import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

export default function ProjectsDashboard() {
  const [, setLocation] = useLocation();

  return (
    <div className="min-h-screen bg-[#f5f5f0] dark:bg-[#0a0a0f]">
      <div className="max-w-5xl mx-auto px-6 pt-4">
        <Button
          variant="outline"
          size="sm"
          className="h-9 gap-2 text-sm font-medium border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
          onClick={() => setLocation("/chat/new")}
          data-testid="button-back-to-chat"
        >
          <ArrowLeft className="h-4 w-4" />
          Atrás
        </Button>
      </div>
    </div>
  );
}
