import { EventEmitter } from 'events';
import { Logger } from '../../lib/logger';
import { redis } from '../../lib/redis';

export type OpportunityType = 'code_quality' | 'documentation' | 'security' | 'performance' | 'workflow' | 'learning';
export type InsightPeriod = 'daily' | 'weekly';
export type ActionStatus = 'pending' | 'scheduled' | 'completed' | 'dismissed';

export interface Opportunity {
  id: string;
  type: OpportunityType;
  title: string;
  description: string;
  impact: number;
  effort: number;
  detectedAt: Date;
  context: string;
}

export interface ProactiveAction {
  id: string;
  opportunityId: string;
  action: string;
  status: ActionStatus;
  scheduledFor?: Date;
  completedAt?: Date;
  result?: string;
}

export interface Insight {
  id: string;
  period: InsightPeriod;
  title: string;
  summary: string;
  highlights: string[];
  suggestions: string[];
  metrics: Record<string, number>;
  generatedAt: Date;
}

const REDIS_KEY_PREFIX = 'agent:initiative:';

export class InitiativeEngine extends EventEmitter {
  private opportunities: Opportunity[] = [];
  private actions: ProactiveAction[] = [];
  private insights: Insight[] = [];
  private observationBuffer: string[] = [];
  private readonly maxOpportunities = 100;
  private readonly maxInsights = 50;

  constructor() {
    super();
  }

  observe(context: string, data: Record<string, any>): void {
    const observation = `[${new Date().toISOString()}] ${context}: ${JSON.stringify(data)}`;
    this.observationBuffer.push(observation);

    if (this.observationBuffer.length > 200) {
      this.observationBuffer = this.observationBuffer.slice(-200);
    }

    this.detectOpportunities(context, data);
  }

  private detectOpportunities(context: string, data: Record<string, any>): void {
    if (context === 'tool_execution') {
      if (data.error && data.toolName) {
        this.addOpportunity({
          type: 'code_quality',
          title: `Recurring error in ${data.toolName}`,
          description: `Tool ${data.toolName} failed with: ${data.error}. Consider investigating the root cause.`,
          impact: 0.7,
          effort: 0.4,
          context,
        });
      }

      if (data.durationMs && data.durationMs > 30000) {
        this.addOpportunity({
          type: 'performance',
          title: `Slow execution: ${data.toolName}`,
          description: `Tool ${data.toolName} took ${(data.durationMs / 1000).toFixed(1)}s. Consider optimizing or caching.`,
          impact: 0.5,
          effort: 0.6,
          context,
        });
      }
    }

    if (context === 'code_analysis') {
      if (data.missingTests) {
        this.addOpportunity({
          type: 'code_quality',
          title: 'Missing test coverage',
          description: `File ${data.file} has no associated tests. Adding tests would improve reliability.`,
          impact: 0.6,
          effort: 0.5,
          context,
        });
      }

      if (data.securityIssue) {
        this.addOpportunity({
          type: 'security',
          title: `Security concern: ${data.securityIssue}`,
          description: `Detected potential security issue: ${data.details}`,
          impact: 0.9,
          effort: 0.3,
          context,
        });
      }
    }

    if (context === 'documentation') {
      if (data.outdated) {
        this.addOpportunity({
          type: 'documentation',
          title: `Outdated documentation: ${data.file}`,
          description: `Documentation may be out of date. Last updated: ${data.lastUpdated}`,
          impact: 0.4,
          effort: 0.3,
          context,
        });
      }
    }

    if (context === 'workflow') {
      if (data.repeatedTask) {
        this.addOpportunity({
          type: 'workflow',
          title: `Automate repeated task: ${data.taskName}`,
          description: `Task "${data.taskName}" has been performed ${data.count} times. Consider creating automation.`,
          impact: 0.6,
          effort: 0.5,
          context,
        });
      }
    }
  }

  private addOpportunity(params: Omit<Opportunity, 'id' | 'detectedAt'>): void {
    const existing = this.opportunities.find(
      o => o.type === params.type && o.title === params.title,
    );
    if (existing) return;

    const opportunity: Opportunity = {
      id: `opp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      detectedAt: new Date(),
      ...params,
    };

    this.opportunities.push(opportunity);
    if (this.opportunities.length > this.maxOpportunities) {
      this.opportunities = this.opportunities
        .sort((a, b) => b.impact - a.impact)
        .slice(0, this.maxOpportunities);
    }

    this.emit('opportunity-detected', opportunity);
  }

  scheduleAction(opportunityId: string, action: string, scheduledFor?: Date): ProactiveAction {
    const proactiveAction: ProactiveAction = {
      id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      opportunityId,
      action,
      status: scheduledFor ? 'scheduled' : 'pending',
      scheduledFor,
    };

    this.actions.push(proactiveAction);
    this.emit('action-scheduled', proactiveAction);
    return proactiveAction;
  }

  completeAction(actionId: string, result: string): void {
    const action = this.actions.find(a => a.id === actionId);
    if (action) {
      action.status = 'completed';
      action.completedAt = new Date();
      action.result = result;
      this.emit('action-completed', action);
    }
  }

  dismissAction(actionId: string): void {
    const action = this.actions.find(a => a.id === actionId);
    if (action) {
      action.status = 'dismissed';
    }
  }

  generateInsight(period: InsightPeriod): Insight {
    const now = new Date();
    const cutoff = new Date(
      now.getTime() - (period === 'daily' ? 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000),
    );

    const recentOpps = this.opportunities.filter(o => o.detectedAt >= cutoff);
    const recentActions = this.actions.filter(
      a => a.completedAt && a.completedAt >= cutoff,
    );

    const highlights: string[] = [];
    const suggestions: string[] = [];

    const oppsByType = new Map<OpportunityType, number>();
    for (const opp of recentOpps) {
      oppsByType.set(opp.type, (oppsByType.get(opp.type) || 0) + 1);
    }

    for (const [type, count] of oppsByType) {
      highlights.push(`${count} ${type.replace('_', ' ')} opportunities detected`);
    }

    if (recentActions.length > 0) {
      highlights.push(`${recentActions.length} proactive actions completed`);
    }

    const highImpactOpps = recentOpps
      .filter(o => o.impact > 0.7)
      .sort((a, b) => b.impact - a.impact)
      .slice(0, 3);

    for (const opp of highImpactOpps) {
      suggestions.push(`[${opp.type}] ${opp.title}: ${opp.description}`);
    }

    if (suggestions.length === 0) {
      suggestions.push('No high-priority improvements detected. Keep up the good work!');
    }

    const insight: Insight = {
      id: `ins_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      period,
      title: `${period === 'daily' ? 'Daily' : 'Weekly'} Project Insights`,
      summary: `${recentOpps.length} opportunities found, ${recentActions.length} actions taken.`,
      highlights,
      suggestions,
      metrics: {
        opportunitiesDetected: recentOpps.length,
        actionsCompleted: recentActions.length,
        highImpactItems: highImpactOpps.length,
      },
      generatedAt: now,
    };

    this.insights.push(insight);
    if (this.insights.length > this.maxInsights) {
      this.insights = this.insights.slice(-this.maxInsights);
    }

    this.emit('insight-generated', insight);
    return insight;
  }

  getTopOpportunities(limit: number = 5): Opportunity[] {
    return [...this.opportunities]
      .sort((a, b) => {
        const scoreA = a.impact * (1 - a.effort * 0.3);
        const scoreB = b.impact * (1 - b.effort * 0.3);
        return scoreB - scoreA;
      })
      .slice(0, limit);
  }

  getPendingActions(): ProactiveAction[] {
    return this.actions.filter(a => a.status === 'pending' || a.status === 'scheduled');
  }

  getRecentInsights(limit: number = 5): Insight[] {
    return this.insights.slice(-limit);
  }

  getSystemPromptFragment(): string {
    const topOpps = this.getTopOpportunities(3);
    if (topOpps.length === 0) {
      return 'No proactive suggestions at this time.';
    }

    const oppsText = topOpps
      .map(o => `- [${o.type}] ${o.title} (impact: ${(o.impact * 100).toFixed(0)}%)`)
      .join('\n');

    return [
      'Proactive observations you may want to mention naturally if relevant:',
      oppsText,
      'Only mention these if contextually appropriate to the conversation.',
    ].join('\n');
  }

  async persistState(): Promise<void> {
    try {
      const data = JSON.stringify({
        opportunities: this.opportunities.slice(-50),
        actions: this.actions.slice(-50),
        insights: this.insights.slice(-20),
      });
      await redis.setex(`${REDIS_KEY_PREFIX}state`, 86400 * 7, data);
    } catch (err) {
      Logger.error('[InitiativeEngine] Failed to persist state:', err);
    }
  }

  async loadState(): Promise<void> {
    try {
      const raw = await redis.get(`${REDIS_KEY_PREFIX}state`);
      if (!raw) return;

      const data = JSON.parse(raw);
      if (data.opportunities) {
        this.opportunities = data.opportunities.map((o: any) => ({
          ...o,
          detectedAt: new Date(o.detectedAt),
        }));
      }
      if (data.actions) {
        this.actions = data.actions.map((a: any) => ({
          ...a,
          scheduledFor: a.scheduledFor ? new Date(a.scheduledFor) : undefined,
          completedAt: a.completedAt ? new Date(a.completedAt) : undefined,
        }));
      }
      if (data.insights) {
        this.insights = data.insights.map((i: any) => ({
          ...i,
          generatedAt: new Date(i.generatedAt),
        }));
      }
    } catch (err) {
      Logger.error('[InitiativeEngine] Failed to load state:', err);
    }
  }
}

export const initiativeEngine = new InitiativeEngine();
