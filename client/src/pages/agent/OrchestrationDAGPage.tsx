import { useParams, useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';
import OrchestrationDAG from '@/components/agent/OrchestrationDAG';

export default function OrchestrationDAGPage() {
  const params = useParams<{ runId: string }>();
  const [, setLocation] = useLocation();

  const runId = params.runId ?? '';

  return (
    <div className="flex flex-col h-screen bg-background" data-testid="orchestration-dag-page">
      <header className="flex items-center gap-3 border-b px-4 py-3 shrink-0">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => setLocation('/')}
          data-testid="button-back"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="text-sm font-semibold" data-testid="text-page-title">DAG Orchestration</h1>
      </header>
      <div className="flex-1 min-h-0">
        {runId ? (
          <OrchestrationDAG runId={runId} />
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm" data-testid="text-no-run-id">
            No run ID specified
          </div>
        )}
      </div>
    </div>
  );
}
