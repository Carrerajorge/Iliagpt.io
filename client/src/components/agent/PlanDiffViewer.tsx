import { useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { Plus, Minus, ArrowRight, Equal } from 'lucide-react';

interface PlanStep {
  description: string;
  toolName?: string;
  status?: string;
}

interface PlanDiffViewerProps {
  oldPlan: { objective?: string; steps: PlanStep[] } | null;
  newPlan: { objective?: string; steps: PlanStep[] } | null;
}

type DiffType = 'added' | 'removed' | 'changed' | 'unchanged';

interface DiffEntry {
  type: DiffType;
  oldStep: PlanStep | null;
  newStep: PlanStep | null;
  index: number;
}

function computeDiff(
  oldSteps: PlanStep[],
  newSteps: PlanStep[]
): DiffEntry[] {
  const result: DiffEntry[] = [];
  const maxLen = Math.max(oldSteps.length, newSteps.length);

  for (let i = 0; i < maxLen; i++) {
    const old = oldSteps[i] ?? null;
    const cur = newSteps[i] ?? null;

    if (!old && cur) {
      result.push({ type: 'added', oldStep: null, newStep: cur, index: i });
    } else if (old && !cur) {
      result.push({ type: 'removed', oldStep: old, newStep: null, index: i });
    } else if (old && cur) {
      const same =
        old.description === cur.description &&
        (old.toolName ?? '') === (cur.toolName ?? '');
      result.push({
        type: same ? 'unchanged' : 'changed',
        oldStep: old,
        newStep: cur,
        index: i,
      });
    }
  }

  return result;
}

const diffConfig: Record<DiffType, { icon: typeof Plus; color: string; bg: string; label: string }> = {
  added: { icon: Plus, color: 'text-green-500', bg: 'bg-green-500/10', label: 'Added' },
  removed: { icon: Minus, color: 'text-red-500', bg: 'bg-red-500/10', label: 'Removed' },
  changed: { icon: ArrowRight, color: 'text-yellow-500', bg: 'bg-yellow-500/10', label: 'Changed' },
  unchanged: { icon: Equal, color: 'text-muted-foreground', bg: 'bg-muted/30', label: 'Unchanged' },
};

function DiffRow({ entry }: { entry: DiffEntry }) {
  const config = diffConfig[entry.type];
  const Icon = config.icon;

  return (
    <div
      className={cn('flex items-start gap-3 p-3 rounded-md border', config.bg)}
      data-testid={`plan-diff-row-${entry.index}`}
    >
      <div className="flex items-center gap-1 shrink-0 mt-0.5">
        <Icon className={cn('h-4 w-4', config.color)} />
        <Badge variant="outline" className={cn('text-[10px]', config.color)}>
          {config.label}
        </Badge>
      </div>

      <div className="flex-1 grid grid-cols-2 gap-4 min-w-0">
        <div className="space-y-1">
          {entry.oldStep ? (
            <>
              <p className={cn('text-sm', entry.type === 'removed' && 'line-through text-red-400')}>
                {entry.oldStep.description}
              </p>
              {entry.oldStep.toolName && (
                <Badge variant="secondary" className="text-[10px]">
                  {entry.oldStep.toolName}
                </Badge>
              )}
            </>
          ) : (
            <span className="text-xs text-muted-foreground italic">—</span>
          )}
        </div>

        <div className="space-y-1">
          {entry.newStep ? (
            <>
              <p className={cn('text-sm', entry.type === 'added' && 'font-medium text-green-400')}>
                {entry.newStep.description}
              </p>
              {entry.newStep.toolName && (
                <Badge variant="secondary" className="text-[10px]">
                  {entry.newStep.toolName}
                </Badge>
              )}
            </>
          ) : (
            <span className="text-xs text-muted-foreground italic">—</span>
          )}
        </div>
      </div>
    </div>
  );
}

export function PlanDiffViewer({ oldPlan, newPlan }: PlanDiffViewerProps) {
  const diff = useMemo(() => {
    const oldSteps = oldPlan?.steps ?? [];
    const newSteps = newPlan?.steps ?? [];
    return computeDiff(oldSteps, newSteps);
  }, [oldPlan, newPlan]);

  const stats = useMemo(() => {
    const added = diff.filter(d => d.type === 'added').length;
    const removed = diff.filter(d => d.type === 'removed').length;
    const changed = diff.filter(d => d.type === 'changed').length;
    const unchanged = diff.filter(d => d.type === 'unchanged').length;
    return { added, removed, changed, unchanged };
  }, [diff]);

  if (!oldPlan && !newPlan) {
    return (
      <div className="text-center text-muted-foreground text-sm py-8" data-testid="plan-diff-empty">
        No plan data available
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="plan-diff-viewer">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Plan Diff</h3>
        <div className="flex items-center gap-2">
          {stats.added > 0 && (
            <Badge variant="outline" className="text-green-500 bg-green-500/10 text-xs" data-testid="diff-stat-added">
              +{stats.added}
            </Badge>
          )}
          {stats.removed > 0 && (
            <Badge variant="outline" className="text-red-500 bg-red-500/10 text-xs" data-testid="diff-stat-removed">
              -{stats.removed}
            </Badge>
          )}
          {stats.changed > 0 && (
            <Badge variant="outline" className="text-yellow-500 bg-yellow-500/10 text-xs" data-testid="diff-stat-changed">
              ~{stats.changed}
            </Badge>
          )}
        </div>
      </div>

      {(oldPlan?.objective || newPlan?.objective) && oldPlan?.objective !== newPlan?.objective && (
        <div className="p-3 rounded-md border bg-yellow-500/5" data-testid="plan-diff-objective">
          <p className="text-xs text-muted-foreground mb-1">Objective changed:</p>
          <div className="grid grid-cols-2 gap-4">
            <p className="text-sm line-through text-red-400">{oldPlan?.objective ?? '—'}</p>
            <p className="text-sm font-medium text-green-400">{newPlan?.objective ?? '—'}</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 text-xs text-muted-foreground font-medium border-b pb-2">
        <span>Previous Plan</span>
        <span>New Plan</span>
      </div>

      <ScrollArea className="max-h-[400px]">
        <div className="space-y-2">
          {diff.map((entry) => (
            <DiffRow key={entry.index} entry={entry} />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

export default PlanDiffViewer;
