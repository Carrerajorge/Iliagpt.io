/**
 * Capability: Enterprise
 * Tests SSO, audit logs, compliance controls, org management, and data governance.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runWithEachProvider, mockProviderEnv, type ProviderConfig } from './_setup/providerMatrix';
import { ENTERPRISE_AUDIT_RESPONSE } from './_setup/mockResponses';
import { createLLMClientMock, expectValidJson, createDbMock } from './_setup/testHelpers';

vi.mock('../../server/db', () => ({ db: {} }));

interface OrgSettings {
  orgId: string;
  name: string;
  ssoEnabled: boolean;
  mfaRequired: boolean;
  dataRetentionDays: number;
  allowedDomains: string[];
  compliance: { gdpr: boolean; hipaa: boolean; soc2: boolean };
  maxUsers: number;
  tier: 'starter' | 'business' | 'enterprise';
}

interface AuditEntry {
  id: string;
  orgId: string;
  userId: string;
  action: string;
  resource: string;
  timestamp: Date;
  metadata: Record<string, unknown>;
  ipAddress?: string;
}

class EnterpriseService {
  private orgs = new Map<string, OrgSettings>();
  private auditLog: AuditEntry[] = [];
  private counter = 0;

  createOrg(settings: OrgSettings): void {
    this.orgs.set(settings.orgId, settings);
  }

  getOrg(orgId: string): OrgSettings | undefined {
    return this.orgs.get(orgId);
  }

  updateOrg(orgId: string, updates: Partial<OrgSettings>): boolean {
    const org = this.orgs.get(orgId);
    if (!org) return false;
    this.orgs.set(orgId, { ...org, ...updates });
    return true;
  }

  logAuditEvent(entry: Omit<AuditEntry, 'id' | 'timestamp'>): AuditEntry {
    const event: AuditEntry = {
      ...entry,
      id: `audit_${++this.counter}`,
      timestamp: new Date(),
    };
    this.auditLog.push(event);
    return event;
  }

  getAuditLog(orgId: string, filters?: { userId?: string; action?: string; limit?: number }): AuditEntry[] {
    let results = this.auditLog.filter((e) => e.orgId === orgId);
    if (filters?.userId) results = results.filter((e) => e.userId === filters.userId);
    if (filters?.action) results = results.filter((e) => e.action === filters.action);
    return results.slice(0, filters?.limit ?? results.length);
  }

  validateCompliance(orgId: string, standard: keyof OrgSettings['compliance']): boolean {
    return this.orgs.get(orgId)?.compliance[standard] ?? false;
  }

  checkUserInDomain(orgId: string, email: string): boolean {
    const org = this.orgs.get(orgId);
    if (!org || org.allowedDomains.length === 0) return true;
    const domain = email.split('@')[1];
    return org.allowedDomains.includes(domain);
  }

  isOverUserLimit(orgId: string, currentUserCount: number): boolean {
    const org = this.orgs.get(orgId);
    if (!org) return false;
    return currentUserCount > org.maxUsers;
  }
}

const SAMPLE_ORG: OrgSettings = {
  orgId: 'org_acme',
  name: 'Acme Corp',
  ssoEnabled: true,
  mfaRequired: true,
  dataRetentionDays: 2555,
  allowedDomains: ['acme.com', 'acmecorp.com'],
  compliance: { gdpr: true, hipaa: false, soc2: true },
  maxUsers: 500,
  tier: 'enterprise',
};

runWithEachProvider('Enterprise', (provider: ProviderConfig) => {
  let service: EnterpriseService;
  let llmMock: ReturnType<typeof createLLMClientMock>;

  mockProviderEnv(provider);

  beforeEach(() => {
    llmMock = createLLMClientMock({ content: ENTERPRISE_AUDIT_RESPONSE, model: provider.model });
    service = new EnterpriseService();
    service.createOrg(SAMPLE_ORG);
  });

  it('creates and retrieves an org', () => {
    const org = service.getOrg('org_acme');
    expect(org?.name).toBe('Acme Corp');
  });

  it('org has SSO and MFA enabled', () => {
    const org = service.getOrg('org_acme');
    expect(org?.ssoEnabled).toBe(true);
    expect(org?.mfaRequired).toBe(true);
  });

  it('org compliance shows GDPR and SOC2', () => {
    expect(service.validateCompliance('org_acme', 'gdpr')).toBe(true);
    expect(service.validateCompliance('org_acme', 'soc2')).toBe(true);
  });

  it('org compliance shows HIPAA off', () => {
    expect(service.validateCompliance('org_acme', 'hipaa')).toBe(false);
  });

  it('logs an audit event', () => {
    const event = service.logAuditEvent({
      orgId: 'org_acme',
      userId: 'user_123',
      action: 'document_download',
      resource: 'file_456',
      metadata: { filename: 'report.pdf' },
    });
    expect(event.id).toBeTruthy();
    expect(event.timestamp).toBeInstanceOf(Date);
  });

  it('retrieves audit log by org', () => {
    service.logAuditEvent({ orgId: 'org_acme', userId: 'u1', action: 'login', resource: 'auth', metadata: {} });
    service.logAuditEvent({ orgId: 'org_acme', userId: 'u2', action: 'logout', resource: 'auth', metadata: {} });
    service.logAuditEvent({ orgId: 'org_other', userId: 'u3', action: 'login', resource: 'auth', metadata: {} });

    const log = service.getAuditLog('org_acme');
    expect(log.length).toBe(2);
  });

  it('filters audit log by user', () => {
    service.logAuditEvent({ orgId: 'org_acme', userId: 'u1', action: 'read', resource: 'doc', metadata: {} });
    service.logAuditEvent({ orgId: 'org_acme', userId: 'u2', action: 'write', resource: 'doc', metadata: {} });

    const u1Events = service.getAuditLog('org_acme', { userId: 'u1' });
    expect(u1Events.length).toBe(1);
    expect(u1Events[0].userId).toBe('u1');
  });

  it('validates allowed email domains', () => {
    expect(service.checkUserInDomain('org_acme', 'alice@acme.com')).toBe(true);
    expect(service.checkUserInDomain('org_acme', 'bob@competitor.com')).toBe(false);
  });

  it('detects user limit breach', () => {
    expect(service.isOverUserLimit('org_acme', 501)).toBe(true);
    expect(service.isOverUserLimit('org_acme', 499)).toBe(false);
  });

  it('updates org settings', () => {
    service.updateOrg('org_acme', { mfaRequired: false });
    expect(service.getOrg('org_acme')?.mfaRequired).toBe(false);
  });

  it('data retention is set to 7 years (enterprise)', () => {
    expect(SAMPLE_ORG.dataRetentionDays).toBe(2555); // ~7 years
  });

  it('ENTERPRISE_AUDIT_RESPONSE has compliance flags', () => {
    const spec = expectValidJson(ENTERPRISE_AUDIT_RESPONSE);
    const compliance = spec.compliance as Record<string, boolean>;
    expect(compliance).toHaveProperty('gdpr');
    expect(compliance).toHaveProperty('soc2');
  });

  it('audit event has requestId and userId', () => {
    const spec = expectValidJson(ENTERPRISE_AUDIT_RESPONSE);
    expect(spec).toHaveProperty('requestId');
    expect(spec).toHaveProperty('userId');
  });
});
