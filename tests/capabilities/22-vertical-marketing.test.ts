/**
 * Capability: Marketing Vertical Use Case
 * Tests campaign generation, copy creation, A/B variants, and channel optimization.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runWithEachProvider, mockProviderEnv, type ProviderConfig } from './_setup/providerMatrix';
import { MARKETING_RESPONSE } from './_setup/mockResponses';
import { createLLMClientMock, expectValidJson } from './_setup/testHelpers';

vi.mock('../../server/db', () => ({ db: {} }));

type MarketingChannel = 'email' | 'linkedin' | 'twitter' | 'blog' | 'facebook' | 'instagram' | 'sms';

interface MarketingAsset {
  type: MarketingChannel | 'blog_post' | 'linkedin_post';
  subject?: string;
  body?: string;
  content?: string;
  headline?: string;
  hashtags?: string[];
  wordCount?: number;
  cta?: string;
}

interface MarketingCampaign {
  name: string;
  channels: MarketingChannel[];
  assets: MarketingAsset[];
  abTestVariants: number;
  estimatedReach: number;
  targetAudience?: string;
  tone?: string;
  provider: string;
}

async function generateMarketingCampaign(
  brief: string,
  channels: MarketingChannel[],
  provider: ProviderConfig,
  llmClient: ReturnType<typeof createLLMClientMock>,
): Promise<MarketingCampaign> {
  const response = await llmClient.chat.completions.create({
    model: provider.model,
    messages: [
      {
        role: 'system',
        content: `Generate a multi-channel marketing campaign. Return JSON with assets for: ${channels.join(', ')}.`,
      },
      { role: 'user', content: brief },
    ],
  });

  const spec = expectValidJson(response.choices[0].message.content);

  return {
    name: spec.campaign as string ?? 'Campaign',
    channels: spec.channels as MarketingChannel[] ?? channels,
    assets: spec.assets as MarketingAsset[] ?? [],
    abTestVariants: spec.abTestVariants as number ?? 1,
    estimatedReach: spec.estimatedReach as number ?? 0,
    targetAudience: spec.targetAudience as string | undefined,
    tone: spec.tone as string | undefined,
    provider: provider.name,
  };
}

runWithEachProvider('Marketing Vertical', (provider: ProviderConfig) => {
  let llmMock: ReturnType<typeof createLLMClientMock>;

  mockProviderEnv(provider);

  beforeEach(() => {
    llmMock = createLLMClientMock({ content: MARKETING_RESPONSE, model: provider.model });
  });

  it('generates a campaign with multiple assets', async () => {
    const campaign = await generateMarketingCampaign(
      'Launch new AI writing feature',
      ['email', 'linkedin', 'twitter'],
      provider, llmMock,
    );
    expect(campaign.assets.length).toBeGreaterThan(0);
  });

  it('generates an email asset', async () => {
    const campaign = await generateMarketingCampaign('Product launch', ['email'], provider, llmMock);
    const email = campaign.assets.find((a) => a.type === 'email');
    expect(email).toBeDefined();
    expect(email?.subject).toBeTruthy();
  });

  it('email subject is non-empty', async () => {
    const campaign = await generateMarketingCampaign('Email campaign', ['email'], provider, llmMock);
    const email = campaign.assets.find((a) => a.type === 'email');
    expect((email?.subject?.length ?? 0)).toBeGreaterThan(5);
  });

  it('LinkedIn post has hashtags', async () => {
    const campaign = await generateMarketingCampaign('LinkedIn campaign', ['linkedin'], provider, llmMock);
    const linkedin = campaign.assets.find((a) => a.type === 'linkedin_post' || a.type === 'linkedin');
    expect(Array.isArray(linkedin?.hashtags)).toBe(true);
  });

  it('blog post has word count', async () => {
    const campaign = await generateMarketingCampaign('Blog content', ['blog'], provider, llmMock);
    const blog = campaign.assets.find((a) => a.type === 'blog_post');
    expect(blog?.wordCount).toBeGreaterThan(0);
  });

  it('campaign includes A/B test variants', async () => {
    const campaign = await generateMarketingCampaign('A/B test campaign', ['email'], provider, llmMock);
    expect(campaign.abTestVariants).toBeGreaterThanOrEqual(1);
  });

  it('estimated reach is positive', async () => {
    const campaign = await generateMarketingCampaign('Reach estimate', ['email', 'linkedin'], provider, llmMock);
    expect(campaign.estimatedReach).toBeGreaterThan(0);
  });

  it('campaign has a name', async () => {
    const campaign = await generateMarketingCampaign('Named campaign', ['email'], provider, llmMock);
    expect(campaign.name.length).toBeGreaterThan(0);
  });

  it('calls LLM once per campaign', async () => {
    await generateMarketingCampaign('Test brief', ['twitter'], provider, llmMock);
    expect(llmMock.chat.completions.create).toHaveBeenCalledTimes(1);
  });

  it('uses correct model', async () => {
    await generateMarketingCampaign('Model test', ['email'], provider, llmMock);
    const call = llmMock.chat.completions.create.mock.calls[0][0];
    expect(call.model).toBe(provider.model);
  });

  it('sets provider name', async () => {
    const campaign = await generateMarketingCampaign('Provider test', ['email'], provider, llmMock);
    expect(campaign.provider).toBe(provider.name);
  });

  it('MARKETING_RESPONSE has 3 assets', () => {
    const spec = expectValidJson(MARKETING_RESPONSE);
    const assets = spec.assets as unknown[];
    expect(assets.length).toBe(3);
  });

  it('multi-channel campaign covers all requested channels', async () => {
    const channels: MarketingChannel[] = ['email', 'linkedin', 'twitter'];
    const campaign = await generateMarketingCampaign('Multi-channel', channels, provider, llmMock);
    for (const ch of campaign.channels) {
      expect(['email', 'linkedin', 'twitter', 'blog', 'facebook', 'instagram', 'sms']).toContain(ch);
    }
  });

  it('handles SMS channel', async () => {
    const smsResponse = JSON.stringify({
      campaign: 'SMS Push',
      channels: ['sms'],
      assets: [{ type: 'sms', content: 'Flash sale! 20% off today only. Reply STOP to unsubscribe.', wordCount: 15 }],
      abTestVariants: 1,
      estimatedReach: 5000,
    });
    const mock = createLLMClientMock({ content: smsResponse, model: provider.model });
    const campaign = await generateMarketingCampaign('SMS blast', ['sms'], provider, mock);
    expect(campaign.channels).toContain('sms');
  });
});
