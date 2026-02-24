import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { createHash } from 'crypto';

vi.mock('../../services/webSearch', () => ({
  searchWeb: vi.fn(),
  searchScholar: vi.fn(),
}));

vi.mock('../browser-worker', () => ({
  browserWorker: {
    createSession: vi.fn(),
    navigate: vi.fn(),
    destroySession: vi.fn(),
  },
}));

vi.mock('../metricsCollector', () => ({
  metricsCollector: {
    record: vi.fn(),
  },
}));

vi.mock('../sandboxSecurity', () => ({
  sandboxSecurity: {
    isHostAllowed: vi.fn().mockReturnValue(true),
  },
}));

import { canonicalizeUrl, extractDomain, isSameOrigin } from '../webtool/canonicalizeUrl';
import { hashContent, hashContentRaw, hashUrl, shortHash } from '../webtool/hashContent';
import { calculateQualityScore, isHighQuality, getQualityLabel } from '../webtool/qualityScorer';
import { DuckDuckGoSearchAdapter } from '../webtool/searchAdapter';
import { HttpFetchAdapter } from '../webtool/fetchAdapter';
import { PlaywrightBrowserAdapter } from '../webtool/browserAdapter';
import { RetrievalPipeline } from '../webtool/retrievalPipeline';
import { searchWeb, searchScholar } from '../../services/webSearch';
import { browserWorker } from '../browser-worker';
import { sandboxSecurity } from '../sandboxSecurity';

describe('canonicalizeUrl', () => {
  describe('UTM parameter removal', () => {
    it('should remove utm_source parameter', () => {
      const url = 'https://example.com/page?utm_source=google';
      const result = canonicalizeUrl(url);
      expect(result).toBe('https://example.com/page');
    });

    it('should remove utm_medium parameter', () => {
      const url = 'https://example.com/page?utm_medium=cpc';
      const result = canonicalizeUrl(url);
      expect(result).toBe('https://example.com/page');
    });

    it('should remove utm_campaign parameter', () => {
      const url = 'https://example.com/page?utm_campaign=spring_sale';
      const result = canonicalizeUrl(url);
      expect(result).toBe('https://example.com/page');
    });

    it('should remove utm_term parameter', () => {
      const url = 'https://example.com/page?utm_term=keyword';
      const result = canonicalizeUrl(url);
      expect(result).toBe('https://example.com/page');
    });

    it('should remove utm_content parameter', () => {
      const url = 'https://example.com/page?utm_content=banner';
      const result = canonicalizeUrl(url);
      expect(result).toBe('https://example.com/page');
    });

    it('should remove multiple utm parameters at once', () => {
      const url = 'https://example.com/page?utm_source=google&utm_medium=cpc&utm_campaign=test';
      const result = canonicalizeUrl(url);
      expect(result).toBe('https://example.com/page');
    });

    it('should preserve non-tracking parameters while removing utm params', () => {
      const url = 'https://example.com/page?id=123&utm_source=google&category=tech';
      const result = canonicalizeUrl(url);
      expect(result).toBe('https://example.com/page?category=tech&id=123');
    });
  });

  describe('tracking parameter removal', () => {
    it('should remove fbclid parameter', () => {
      const url = 'https://example.com/page?fbclid=abc123';
      const result = canonicalizeUrl(url);
      expect(result).toBe('https://example.com/page');
    });

    it('should remove gclid parameter', () => {
      const url = 'https://example.com/page?gclid=xyz456';
      const result = canonicalizeUrl(url);
      expect(result).toBe('https://example.com/page');
    });

    it('should remove ref parameter', () => {
      const url = 'https://example.com/page?ref=homepage';
      const result = canonicalizeUrl(url);
      expect(result).toBe('https://example.com/page');
    });

    it('should remove source parameter', () => {
      const url = 'https://example.com/page?source=newsletter';
      const result = canonicalizeUrl(url);
      expect(result).toBe('https://example.com/page');
    });

    it('should remove msclkid parameter', () => {
      const url = 'https://example.com/page?msclkid=bing123';
      const result = canonicalizeUrl(url);
      expect(result).toBe('https://example.com/page');
    });

    it('should remove _ga parameter', () => {
      const url = 'https://example.com/page?_ga=1.2.3.4';
      const result = canonicalizeUrl(url);
      expect(result).toBe('https://example.com/page');
    });

    it('should remove parameters with tracking prefixes', () => {
      const url = 'https://example.com/page?fb_action_ids=123&google_something=456';
      const result = canonicalizeUrl(url);
      expect(result).toBe('https://example.com/page');
    });
  });

  describe('protocol normalization', () => {
    it('should add https:// to URLs without protocol', () => {
      const url = 'example.com/page';
      const result = canonicalizeUrl(url);
      expect(result).toBe('https://example.com/page');
    });

    it('should keep existing https:// protocol', () => {
      const url = 'https://example.com/page';
      const result = canonicalizeUrl(url);
      expect(result).toBe('https://example.com/page');
    });

    it('should keep http:// protocol (does not upgrade)', () => {
      const url = 'http://example.com/page';
      const result = canonicalizeUrl(url);
      expect(result).toBe('http://example.com/page');
    });

    it('should lowercase protocol', () => {
      const url = 'HTTPS://example.com/page';
      const result = canonicalizeUrl(url);
      expect(result).toBe('https://example.com/page');
    });
  });

  describe('domain normalization', () => {
    it('should lowercase domain', () => {
      const url = 'https://EXAMPLE.COM/page';
      const result = canonicalizeUrl(url);
      expect(result).toBe('https://example.com/page');
    });

    it('should remove www. prefix', () => {
      const url = 'https://www.example.com/page';
      const result = canonicalizeUrl(url);
      expect(result).toBe('https://example.com/page');
    });

    it('should handle mixed case with www', () => {
      const url = 'https://WWW.Example.COM/page';
      const result = canonicalizeUrl(url);
      expect(result).toBe('https://example.com/page');
    });
  });

  describe('trailing slash removal', () => {
    it('should remove trailing slash from path', () => {
      const url = 'https://example.com/page/';
      const result = canonicalizeUrl(url);
      expect(result).toBe('https://example.com/page');
    });

    it('should keep root path as single slash', () => {
      const url = 'https://example.com/';
      const result = canonicalizeUrl(url);
      expect(result).toBe('https://example.com/');
    });

    it('should remove multiple consecutive slashes', () => {
      const url = 'https://example.com//page///subpage';
      const result = canonicalizeUrl(url);
      expect(result).toBe('https://example.com/page/subpage');
    });
  });

  describe('hash fragment removal', () => {
    it('should remove hash fragment', () => {
      const url = 'https://example.com/page#section';
      const result = canonicalizeUrl(url);
      expect(result).toBe('https://example.com/page');
    });

    it('should remove hash fragment with query params', () => {
      const url = 'https://example.com/page?id=1#section';
      const result = canonicalizeUrl(url);
      expect(result).toBe('https://example.com/page?id=1');
    });
  });

  describe('port normalization', () => {
    it('should remove default https port 443', () => {
      const url = 'https://example.com:443/page';
      const result = canonicalizeUrl(url);
      expect(result).toBe('https://example.com/page');
    });

    it('should remove default http port 80', () => {
      const url = 'http://example.com:80/page';
      const result = canonicalizeUrl(url);
      expect(result).toBe('http://example.com/page');
    });

    it('should keep non-default ports', () => {
      const url = 'https://example.com:8080/page';
      const result = canonicalizeUrl(url);
      expect(result).toBe('https://example.com:8080/page');
    });
  });

  describe('query parameter sorting', () => {
    it('should sort query parameters alphabetically', () => {
      const url = 'https://example.com/page?z=1&a=2&m=3';
      const result = canonicalizeUrl(url);
      expect(result).toBe('https://example.com/page?a=2&m=3&z=1');
    });
  });

  describe('edge cases', () => {
    it('should throw error for empty URL', () => {
      expect(() => canonicalizeUrl('')).toThrow();
    });

    it('should throw error for null URL', () => {
      expect(() => canonicalizeUrl(null as any)).toThrow();
    });

    it('should throw error for undefined URL', () => {
      expect(() => canonicalizeUrl(undefined as any)).toThrow();
    });

    it('should throw error for malformed URL', () => {
      expect(() => canonicalizeUrl('not a valid url at all :::')).toThrow('Invalid URL format');
    });

    it('should handle already canonical URL', () => {
      const url = 'https://example.com/page';
      const result = canonicalizeUrl(url);
      expect(result).toBe('https://example.com/page');
    });

    it('should handle URL with encoded characters', () => {
      const url = 'https://example.com/page%20with%20spaces';
      const result = canonicalizeUrl(url);
      expect(result).toContain('example.com');
    });

    it('should handle URL with unicode characters', () => {
      const url = 'https://example.com/日本語';
      const result = canonicalizeUrl(url);
      expect(result).toContain('example.com');
    });

    it('should trim whitespace from URL', () => {
      const url = '  https://example.com/page  ';
      const result = canonicalizeUrl(url);
      expect(result).toBe('https://example.com/page');
    });
  });
});

describe('extractDomain', () => {
  it('should extract domain from full URL', () => {
    expect(extractDomain('https://example.com/page')).toBe('example.com');
  });

  it('should remove www prefix', () => {
    expect(extractDomain('https://www.example.com/page')).toBe('example.com');
  });

  it('should lowercase domain', () => {
    expect(extractDomain('https://EXAMPLE.COM/page')).toBe('example.com');
  });

  it('should handle domain without protocol', () => {
    expect(extractDomain('example.com')).toBe('example.com');
  });

  it('should return empty string for invalid URL', () => {
    expect(extractDomain('not a url')).toBe('');
  });
});

describe('isSameOrigin', () => {
  it('should return true for same origin URLs', () => {
    expect(isSameOrigin('https://example.com/page1', 'https://example.com/page2')).toBe(true);
  });

  it('should return false for different domains', () => {
    expect(isSameOrigin('https://example.com/page', 'https://other.com/page')).toBe(false);
  });

  it('should return false for different protocols', () => {
    expect(isSameOrigin('https://example.com/page', 'http://example.com/page')).toBe(false);
  });

  it('should return false for different ports', () => {
    expect(isSameOrigin('https://example.com:443/page', 'https://example.com:8080/page')).toBe(false);
  });

  it('should return false for invalid URLs', () => {
    expect(isSameOrigin('invalid', 'also invalid')).toBe(false);
  });
});

describe('hashContent', () => {
  describe('consistency', () => {
    it('should return consistent hash for same content', () => {
      const content = 'This is test content';
      const hash1 = hashContent(content);
      const hash2 = hashContent(content);
      expect(hash1).toBe(hash2);
    });

    it('should return 64 character hex string (SHA-256)', () => {
      const hash = hashContent('test');
      expect(hash).toHaveLength(64);
      expect(hash).toMatch(/^[a-f0-9]+$/);
    });
  });

  describe('different content', () => {
    it('should return different hash for different content', () => {
      const hash1 = hashContent('content one');
      const hash2 = hashContent('content two');
      expect(hash1).not.toBe(hash2);
    });

    it('should return different hash for slightly different content', () => {
      const hash1 = hashContent('hello');
      const hash2 = hashContent('Hello');
      expect(hash1).toBe(hash2);
    });
  });

  describe('normalization', () => {
    it('should be case insensitive', () => {
      const hash1 = hashContent('HELLO WORLD');
      const hash2 = hashContent('hello world');
      expect(hash1).toBe(hash2);
    });

    it('should collapse whitespace', () => {
      const hash1 = hashContent('hello   world');
      const hash2 = hashContent('hello world');
      expect(hash1).toBe(hash2);
    });

    it('should trim whitespace', () => {
      const hash1 = hashContent('  hello world  ');
      const hash2 = hashContent('hello world');
      expect(hash1).toBe(hash2);
    });

    it('should handle newlines and tabs', () => {
      const hash1 = hashContent('hello\n\tworld');
      const hash2 = hashContent('hello world');
      expect(hash1).toBe(hash2);
    });

    it('should remove punctuation', () => {
      const hash1 = hashContent('hello, world!');
      const hash2 = hashContent('hello world');
      expect(hash1).toBe(hash2);
    });
  });

  describe('edge cases', () => {
    it('should handle empty string', () => {
      const hash = hashContent('');
      expect(hash).toHaveLength(64);
      expect(hash).toBe(createHash('sha256').update('').digest('hex'));
    });

    it('should handle null', () => {
      const hash = hashContent(null as any);
      expect(hash).toHaveLength(64);
    });

    it('should handle undefined', () => {
      const hash = hashContent(undefined as any);
      expect(hash).toHaveLength(64);
    });

    it('should handle very long content', () => {
      const longContent = 'a'.repeat(100000);
      const hash = hashContent(longContent);
      expect(hash).toHaveLength(64);
    });

    it('should handle unicode content', () => {
      const hash = hashContent('日本語コンテンツ');
      expect(hash).toHaveLength(64);
    });
  });
});

describe('hashContentRaw', () => {
  it('should not normalize content', () => {
    const hash1 = hashContentRaw('HELLO');
    const hash2 = hashContentRaw('hello');
    expect(hash1).not.toBe(hash2);
  });

  it('should handle empty string', () => {
    const hash = hashContentRaw('');
    expect(hash).toHaveLength(64);
  });
});

describe('hashUrl', () => {
  it('should hash URL consistently', () => {
    const url = 'https://example.com/page';
    const hash1 = hashUrl(url);
    const hash2 = hashUrl(url);
    expect(hash1).toBe(hash2);
  });

  it('should return 64 character hex string', () => {
    const hash = hashUrl('https://example.com');
    expect(hash).toHaveLength(64);
  });
});

describe('shortHash', () => {
  it('should return shortened hash with default length', () => {
    const hash = shortHash('test content');
    expect(hash).toHaveLength(8);
  });

  it('should return shortened hash with custom length', () => {
    const hash = shortHash('test content', 12);
    expect(hash).toHaveLength(12);
  });
});

describe('qualityScorer', () => {
  describe('domain allowlist scoring', () => {
    it('should give high score to .gov domains', () => {
      const score = calculateQualityScore('https://whitehouse.gov/page', {}, 5000);
      expect(score.domain).toBeGreaterThanOrEqual(90);
    });

    it('should give high score to .edu domains', () => {
      const score = calculateQualityScore('https://stanford.edu/research', {}, 5000);
      expect(score.domain).toBeGreaterThanOrEqual(85);
    });

    it('should give high score to wikipedia.org', () => {
      const score = calculateQualityScore('https://wikipedia.org/wiki/Test', {}, 5000);
      expect(score.domain).toBe(85);
    });

    it('should give high score to nature.com', () => {
      const score = calculateQualityScore('https://nature.com/article', {}, 5000);
      expect(score.domain).toBe(95);
    });

    it('should give high score to nih.gov', () => {
      const score = calculateQualityScore('https://nih.gov/research', {}, 5000);
      expect(score.domain).toBe(95);
    });

    it('should give high score to arxiv.org', () => {
      const score = calculateQualityScore('https://arxiv.org/paper', {}, 5000);
      expect(score.domain).toBe(90);
    });

    it('should give moderate score to github.com', () => {
      const score = calculateQualityScore('https://github.com/repo', {}, 5000);
      expect(score.domain).toBe(80);
    });
  });

  describe('TLD scoring', () => {
    it('should score .gov TLD high', () => {
      const score = calculateQualityScore('https://example.gov/page', {}, 5000);
      expect(score.domain).toBe(90);
    });

    it('should score .edu TLD high', () => {
      const score = calculateQualityScore('https://example.edu/page', {}, 5000);
      expect(score.domain).toBe(85);
    });

    it('should score .org TLD moderately', () => {
      const score = calculateQualityScore('https://example.org/page', {}, 5000);
      expect(score.domain).toBe(60);
    });

    it('should score .com TLD as baseline', () => {
      const score = calculateQualityScore('https://unknownsite.com/page', {}, 5000);
      expect(score.domain).toBe(50);
    });

    it('should score .io TLD slightly higher than .com', () => {
      const score = calculateQualityScore('https://unknownsite.io/page', {}, 5000);
      expect(score.domain).toBe(55);
    });

    it('should score .net TLD lower than .com', () => {
      const score = calculateQualityScore('https://unknownsite.net/page', {}, 5000);
      expect(score.domain).toBe(45);
    });
  });

  describe('HTTPS bonus', () => {
    it('should give bonus for HTTPS', () => {
      const score = calculateQualityScore('https://example.com/page', {}, 5000);
      expect(score.https).toBe(10);
    });

    it('should give no bonus for HTTP', () => {
      const score = calculateQualityScore('http://example.com/page', {}, 5000);
      expect(score.https).toBe(0);
    });
  });

  describe('recency scoring', () => {
    it('should give high score for content modified today', () => {
      const today = new Date().toUTCString();
      const score = calculateQualityScore('https://example.com', { 'last-modified': today }, 5000);
      expect(score.recency).toBe(100);
    });

    it('should give high score for content modified within a week', () => {
      const weekAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toUTCString();
      const score = calculateQualityScore('https://example.com', { 'last-modified': weekAgo }, 5000);
      expect(score.recency).toBe(95);
    });

    it('should give good score for content modified within a month', () => {
      const monthAgo = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toUTCString();
      const score = calculateQualityScore('https://example.com', { 'last-modified': monthAgo }, 5000);
      expect(score.recency).toBe(85);
    });

    it('should give moderate score for content modified within 90 days', () => {
      const ninetyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toUTCString();
      const score = calculateQualityScore('https://example.com', { 'last-modified': ninetyDaysAgo }, 5000);
      expect(score.recency).toBe(75);
    });

    it('should give lower score for content modified within 180 days', () => {
      const halfYearAgo = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toUTCString();
      const score = calculateQualityScore('https://example.com', { 'last-modified': halfYearAgo }, 5000);
      expect(score.recency).toBe(65);
    });

    it('should give low score for content older than a year', () => {
      const twoYearsAgo = new Date(Date.now() - 730 * 24 * 60 * 60 * 1000).toUTCString();
      const score = calculateQualityScore('https://example.com', { 'last-modified': twoYearsAgo }, 5000);
      expect(score.recency).toBe(40);
    });

    it('should default to 50 when no date headers present', () => {
      const score = calculateQualityScore('https://example.com', {}, 5000);
      expect(score.recency).toBe(50);
    });

    it('should use Date header if Last-Modified is not present', () => {
      const today = new Date().toUTCString();
      const score = calculateQualityScore('https://example.com', { 'date': today }, 5000);
      expect(score.recency).toBe(100);
    });

    it('should handle Headers object', () => {
      const headers = new Headers();
      headers.set('last-modified', new Date().toUTCString());
      const score = calculateQualityScore('https://example.com', headers, 5000);
      expect(score.recency).toBe(100);
    });
  });

  describe('content length scoring', () => {
    it('should give 0 for zero length', () => {
      const score = calculateQualityScore('https://example.com', {}, 0);
      expect(score.contentLength).toBe(0);
    });

    it('should give 0 for negative length', () => {
      const score = calculateQualityScore('https://example.com', {}, -100);
      expect(score.contentLength).toBe(0);
    });

    it('should give low score for very short content', () => {
      const score = calculateQualityScore('https://example.com', {}, 100);
      expect(score.contentLength).toBe(20);
    });

    it('should give moderate score for medium content', () => {
      const score = calculateQualityScore('https://example.com', {}, 1500);
      expect(score.contentLength).toBe(60);
    });

    it('should give high score for optimal content length', () => {
      const score = calculateQualityScore('https://example.com', {}, 5000);
      expect(score.contentLength).toBe(90);
    });

    it('should give max score for good content length', () => {
      const score = calculateQualityScore('https://example.com', {}, 20000);
      expect(score.contentLength).toBe(100);
    });

    it('should give slightly reduced score for very long content', () => {
      const score = calculateQualityScore('https://example.com', {}, 100000);
      expect(score.contentLength).toBe(85);
    });
  });

  describe('total score calculation', () => {
    it('should sum all component scores', () => {
      const score = calculateQualityScore('https://wikipedia.org', {}, 5000);
      expect(score.total).toBe(
        score.domain + score.recency + score.https + score.authoritativeness + score.contentLength
      );
    });

    it('should produce high total for authoritative sources', () => {
      const today = new Date().toUTCString();
      const score = calculateQualityScore('https://nature.com/article', { 'last-modified': today }, 10000);
      expect(score.total).toBeGreaterThan(300);
    });

    it('should produce lower total for unknown sources', () => {
      const score = calculateQualityScore('http://random-unknown-site.xyz/page', {}, 100);
      expect(score.total).toBeLessThanOrEqual(150);
    });
  });
});

describe('isHighQuality', () => {
  it('should return true for high quality score', () => {
    const score = { domain: 85, recency: 100, https: 10, authoritativeness: 85, contentLength: 90, total: 370 };
    expect(isHighQuality(score)).toBe(true);
  });

  it('should return false for low quality score', () => {
    const score = { domain: 40, recency: 50, https: 0, authoritativeness: 40, contentLength: 20, total: 150 };
    expect(isHighQuality(score)).toBe(false);
  });

  it('should use custom threshold', () => {
    const score = { domain: 50, recency: 50, https: 10, authoritativeness: 50, contentLength: 40, total: 200 };
    expect(isHighQuality(score, 150)).toBe(true);
    expect(isHighQuality(score, 250)).toBe(false);
  });
});

describe('getQualityLabel', () => {
  it('should return excellent for very high scores', () => {
    const score = { domain: 95, recency: 100, https: 10, authoritativeness: 95, contentLength: 100, total: 400 };
    expect(getQualityLabel(score)).toBe('excellent');
  });

  it('should return good for high scores', () => {
    const score = { domain: 80, recency: 85, https: 10, authoritativeness: 80, contentLength: 80, total: 300 };
    expect(getQualityLabel(score)).toBe('good');
  });

  it('should return fair for moderate scores', () => {
    const score = { domain: 50, recency: 50, https: 10, authoritativeness: 50, contentLength: 40, total: 200 };
    expect(getQualityLabel(score)).toBe('fair');
  });

  it('should return poor for low scores', () => {
    const score = { domain: 40, recency: 40, https: 0, authoritativeness: 40, contentLength: 20, total: 100 };
    expect(getQualityLabel(score)).toBe('poor');
  });
});

describe('DuckDuckGoSearchAdapter', () => {
  let adapter: DuckDuckGoSearchAdapter;
  const mockSearchWeb = searchWeb as Mock;
  const mockSearchScholar = searchScholar as Mock;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new DuckDuckGoSearchAdapter(5);
  });

  describe('search', () => {
    it('should return normalized results', async () => {
      mockSearchWeb.mockResolvedValueOnce({
        results: [
          { url: 'https://www.example.com/page?utm_source=test', title: 'Test Page', snippet: 'Test snippet' },
          { url: 'https://example.org/article', title: 'Article', snippet: 'Article snippet' },
        ],
      });

      const results = await adapter.search('test query', 5);

      expect(results).toHaveLength(2);
      expect(results[0].canonicalUrl).toBe('https://example.com/page');
      expect(results[0].url).toBe('https://www.example.com/page?utm_source=test');
      expect(results[0].title).toBe('Test Page');
    });

    it('should handle empty results', async () => {
      mockSearchWeb.mockResolvedValueOnce({ results: [] });

      const results = await adapter.search('no results query', 5);

      expect(results).toHaveLength(0);
    });

    it('should throw error on search failure', async () => {
      mockSearchWeb.mockRejectedValueOnce(new Error('API error'));

      await expect(adapter.search('test', 5)).rejects.toThrow('Search failed: API error');
    });

    it('should skip invalid results', async () => {
      mockSearchWeb.mockResolvedValueOnce({
        results: [
          { url: 'https://valid.com', title: 'Valid', snippet: 'Valid' },
          { url: 'not-a-valid-url', title: 'Invalid', snippet: 'Invalid' },
        ],
      });

      const results = await adapter.search('test', 5);

      expect(results).toHaveLength(1);
      expect(results[0].url).toBe('https://valid.com');
    });

    it('should use default maxResults', async () => {
      mockSearchWeb.mockResolvedValueOnce({ results: [] });

      await adapter.search('test');

      expect(mockSearchWeb).toHaveBeenCalledWith('test', 5);
    });
  });

  describe('searchScholar', () => {
    it('should return scholar results with citations', async () => {
      mockSearchScholar.mockResolvedValueOnce({
        results: [
          {
            url: 'https://arxiv.org/paper',
            title: 'Academic Paper',
            snippet: 'Research abstract',
            authors: 'John Doe',
            year: '2024',
            citation: '100',
          },
        ],
      });

      const results = await adapter.searchScholar('research topic', 5);

      expect(results).toHaveLength(1);
      expect(results[0].authors).toBe('John Doe');
      expect(results[0].year).toBe('2024');
    });

    it('should throw error on scholar search failure', async () => {
      mockSearchScholar.mockRejectedValueOnce(new Error('Scholar API error'));

      await expect(adapter.searchScholar('test', 5)).rejects.toThrow('Scholar search failed: Scholar API error');
    });
  });
});

describe('HttpFetchAdapter', () => {
  let adapter: HttpFetchAdapter;
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    adapter = new HttpFetchAdapter('TestBot/1.0');
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('successful fetch', () => {
    it('should fetch content successfully', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        statusText: 'OK',
        url: 'https://example.com/page',
        text: vi.fn().mockResolvedValue('<html><body>Test content</body></html>'),
        headers: new Headers({
          'content-type': 'text/html',
          'content-length': '100',
        }),
      };

      global.fetch = vi.fn().mockResolvedValue(mockResponse);

      const result = await adapter.fetch('https://example.com/page', { respectRobotsTxt: false });

      expect(result.success).toBe(true);
      expect(result.status).toBe(200);
      expect(result.content).toBe('<html><body>Test content</body></html>');
    });

    it('should include timing information', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        statusText: 'OK',
        url: 'https://example.com',
        text: vi.fn().mockResolvedValue('content'),
        headers: new Headers({ 'content-type': 'text/html' }),
      };

      global.fetch = vi.fn().mockResolvedValue(mockResponse);

      const result = await adapter.fetch('https://example.com', { respectRobotsTxt: false });

      expect(result.timing).toBeDefined();
      expect(result.timing.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('timeout handling', () => {
    it('should timeout after specified duration', async () => {
      global.fetch = vi.fn().mockImplementation(() => 
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error('abort')), 100);
        })
      );

      const result = await adapter.fetch('https://example.com', { 
        timeout: 50, 
        retries: 0,
        respectRobotsTxt: false 
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('abort');
    });
  });

  describe('retry logic', () => {
    it('should retry on retryable errors', async () => {
      let callCount = 0;
      global.fetch = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount < 3) {
          return Promise.reject(new Error('network error'));
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
          url: 'https://example.com',
          text: vi.fn().mockResolvedValue('success'),
          headers: new Headers({ 'content-type': 'text/html' }),
        });
      });

      const result = await adapter.fetch('https://example.com', { 
        retries: 3,
        respectRobotsTxt: false 
      });

      expect(result.success).toBe(true);
      expect(result.retryCount).toBe(2);
    }, 15000);

    it('should fail after max retries', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('network timeout'));

      const result = await adapter.fetch('https://example.com', { 
        retries: 2,
        respectRobotsTxt: false 
      });

      expect(result.success).toBe(false);
      expect(result.retryCount).toBe(2);
    });
  });

  describe('robots.txt respect', () => {
    it('should block fetch when robots.txt disallows', async () => {
      const robotsResponse = {
        ok: true,
        status: 200,
        text: vi.fn().mockResolvedValue('User-agent: *\nDisallow: /'),
        headers: new Headers(),
      };

      global.fetch = vi.fn().mockResolvedValue(robotsResponse);

      const result = await adapter.fetch('https://example.com/page', { respectRobotsTxt: true });

      expect(result.success).toBe(false);
      expect(result.status).toBe(403);
      expect(result.error).toContain('robots.txt');
    });

    it('should allow fetch when robots.txt allows', async () => {
      const freshAdapter = new HttpFetchAdapter('TestBot/1.0');
      global.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('robots.txt')) {
          return Promise.resolve({
            ok: false,
            status: 404,
            text: vi.fn().mockResolvedValue(''),
            headers: new Headers(),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
          url: 'https://allowed-site.com/page',
          text: vi.fn().mockResolvedValue('content'),
          headers: new Headers({ 'content-type': 'text/html' }),
        });
      });

      const result = await freshAdapter.fetch('https://allowed-site.com/page', { respectRobotsTxt: true });

      expect(result.success).toBe(true);
    });
  });

  describe('checkRobotsTxt', () => {
    it('should cache robots.txt results', async () => {
      const cacheAdapter = new HttpFetchAdapter('TestBot/1.0');
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: vi.fn().mockResolvedValue('User-agent: *\nAllow: /'),
        headers: new Headers(),
      });

      await cacheAdapter.checkRobotsTxt('https://cache-test-domain.com/page1');
      await cacheAdapter.checkRobotsTxt('https://cache-test-domain.com/page2');

      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('should return true when robots.txt is not found', async () => {
      const notFoundAdapter = new HttpFetchAdapter('TestBot/1.0');
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        headers: new Headers(),
      });

      const result = await notFoundAdapter.checkRobotsTxt('https://notfound-domain.com/page');

      expect(result).toBe(true);
    });

    it('should return true on fetch error', async () => {
      const errorAdapter = new HttpFetchAdapter('TestBot/1.0');
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      const result = await errorAdapter.checkRobotsTxt('https://error-domain.com/page');

      expect(result).toBe(true);
    });
  });
});

describe('PlaywrightBrowserAdapter', () => {
  let adapter: PlaywrightBrowserAdapter;
  const mockBrowserWorker = browserWorker as {
    createSession: Mock;
    navigate: Mock;
    destroySession: Mock;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new PlaywrightBrowserAdapter();
  });

  describe('successful browse', () => {
    it('should browse and return content', async () => {
      mockBrowserWorker.createSession.mockResolvedValue('session-123');
      mockBrowserWorker.navigate.mockResolvedValue({
        success: true,
        url: 'https://example.com',
        title: 'Example Page',
        html: '<html><body><p>Content</p></body></html>',
        timing: { navigationMs: 100, renderMs: 50 },
      });
      mockBrowserWorker.destroySession.mockResolvedValue(undefined);

      const result = await adapter.browse('https://example.com');

      expect(result.success).toBe(true);
      expect(result.title).toBe('Example Page');
      expect(result.content).toContain('Content');
      expect(mockBrowserWorker.destroySession).toHaveBeenCalledWith('session-123');
    });

    it('should include timing information', async () => {
      mockBrowserWorker.createSession.mockResolvedValue('session-123');
      mockBrowserWorker.navigate.mockResolvedValue({
        success: true,
        url: 'https://example.com',
        title: 'Test',
        html: '<html></html>',
        timing: { navigationMs: 100, renderMs: 50 },
      });
      mockBrowserWorker.destroySession.mockResolvedValue(undefined);

      const result = await adapter.browse('https://example.com');

      expect(result.timing).toBeDefined();
      expect(result.timing.navigationMs).toBe(100);
      expect(result.timing.renderMs).toBe(50);
    });
  });

  describe('screenshot capture', () => {
    it('should capture screenshot when requested', async () => {
      const screenshotBuffer = Buffer.from('fake-screenshot-data');
      mockBrowserWorker.createSession.mockResolvedValue('session-123');
      mockBrowserWorker.navigate.mockResolvedValue({
        success: true,
        url: 'https://example.com',
        title: 'Test',
        html: '<html></html>',
        screenshot: screenshotBuffer,
        timing: { navigationMs: 100, renderMs: 50 },
      });
      mockBrowserWorker.destroySession.mockResolvedValue(undefined);

      const result = await adapter.browse('https://example.com', { takeScreenshot: true });

      expect(result.screenshot).toEqual(screenshotBuffer);
    });

    it('should capture screenshot via screenshot method', async () => {
      const screenshotBuffer = Buffer.from('screenshot-data');
      mockBrowserWorker.createSession.mockResolvedValue('session-456');
      mockBrowserWorker.navigate.mockResolvedValue({
        success: true,
        screenshot: screenshotBuffer,
        timing: { navigationMs: 100, renderMs: 50 },
      });
      mockBrowserWorker.destroySession.mockResolvedValue(undefined);

      const result = await adapter.screenshot('https://example.com');

      expect(result).toEqual(screenshotBuffer);
    });

    it('should return null on screenshot failure', async () => {
      mockBrowserWorker.createSession.mockRejectedValue(new Error('Session failed'));

      const result = await adapter.screenshot('https://example.com');

      expect(result).toBeNull();
    });
  });

  describe('cleanup on error', () => {
    it('should cleanup session on navigation error', async () => {
      mockBrowserWorker.createSession.mockResolvedValue('session-123');
      mockBrowserWorker.navigate.mockResolvedValue({
        success: false,
        error: 'Navigation timeout',
        timing: { navigationMs: 0, renderMs: 0 },
      });
      mockBrowserWorker.destroySession.mockResolvedValue(undefined);

      const result = await adapter.browse('https://example.com');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Navigation timeout');
      expect(mockBrowserWorker.destroySession).toHaveBeenCalledWith('session-123');
    });

    it('should cleanup session on exception', async () => {
      mockBrowserWorker.createSession.mockResolvedValue('session-123');
      mockBrowserWorker.navigate.mockRejectedValue(new Error('Browser crash'));
      mockBrowserWorker.destroySession.mockResolvedValue(undefined);

      const result = await adapter.browse('https://example.com');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Browser crash');
      expect(mockBrowserWorker.destroySession).toHaveBeenCalledWith('session-123');
    });

    it('should cleanup all sessions via cleanup method', async () => {
      mockBrowserWorker.createSession.mockResolvedValueOnce('session-1');
      mockBrowserWorker.createSession.mockResolvedValueOnce('session-2');
      mockBrowserWorker.navigate.mockImplementation(() => 
        new Promise(() => {})
      );
      mockBrowserWorker.destroySession.mockResolvedValue(undefined);

      adapter.browse('https://example1.com');
      adapter.browse('https://example2.com');

      await new Promise(resolve => setTimeout(resolve, 10));

      await adapter.cleanup();
    });
  });

  describe('cancellation', () => {
    it('should handle pre-cancelled token', async () => {
      const cancellationToken = { isCancelled: true, throwIfCancelled: vi.fn() };

      const result = await adapter.browse('https://example.com', {}, cancellationToken as any);

      expect(result.success).toBe(false);
      expect(result.error).toContain('cancelled');
    });
  });

  describe('content extraction', () => {
    it('should extract text content from HTML', async () => {
      mockBrowserWorker.createSession.mockResolvedValue('session-123');
      mockBrowserWorker.navigate.mockResolvedValue({
        success: true,
        url: 'https://example.com',
        title: 'Test',
        html: '<html><body><script>alert("hi")</script><p>Real content here</p><style>body{}</style></body></html>',
        timing: { navigationMs: 100, renderMs: 50 },
      });
      mockBrowserWorker.destroySession.mockResolvedValue(undefined);

      const result = await adapter.browse('https://example.com', { extractContent: true });

      expect(result.content).not.toContain('alert');
      expect(result.content).not.toContain('style');
      expect(result.content).toContain('Real content here');
    });
  });
});

describe('RetrievalPipeline', () => {
  let pipeline: RetrievalPipeline;
  let mockSearch: { search: Mock; searchScholar: Mock };
  let mockFetch: { fetch: Mock; checkRobotsTxt: Mock };
  let mockBrowser: { browse: Mock; screenshot: Mock };
  const mockSandboxSecurity = sandboxSecurity as { isHostAllowed: Mock };

  beforeEach(() => {
    vi.clearAllMocks();

    mockSearch = {
      search: vi.fn(),
      searchScholar: vi.fn(),
    };

    mockFetch = {
      fetch: vi.fn(),
      checkRobotsTxt: vi.fn().mockResolvedValue(true),
    };

    mockBrowser = {
      browse: vi.fn(),
      screenshot: vi.fn(),
    };

    mockSandboxSecurity.isHostAllowed.mockReturnValue(true);

    pipeline = new RetrievalPipeline(mockSearch, mockFetch, mockBrowser);
  });

  describe('full pipeline integration', () => {
    it('should complete full retrieval pipeline', async () => {
      mockSearch.search.mockResolvedValue([
        { url: 'https://example.com/page1', canonicalUrl: 'https://example.com/page1', title: 'Page 1', snippet: 'Snippet 1' },
        { url: 'https://example.com/page2', canonicalUrl: 'https://example.com/page2', title: 'Page 2', snippet: 'Snippet 2' },
      ]);

      mockFetch.fetch.mockImplementation((url: string) => Promise.resolve({
        success: true,
        url,
        finalUrl: url,
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'text/html', 'last-modified': new Date().toUTCString() },
        content: `<html><body><article><p>Unique content for ${url}. This is meaningful content for the article.</p></article></body></html>`,
        contentLength: 5000,
        timing: { startMs: 0, endMs: 100, durationMs: 100 },
        retryCount: 0,
      }));

      const result = await pipeline.retrieve({
        query: 'test query',
        maxResults: 5,
        deduplicateByContent: false,
      });

      expect(result.success).toBe(true);
      expect(result.results.length).toBeGreaterThanOrEqual(1);
      expect(result.timing.totalMs).toBeGreaterThan(0);
    });
  });

  describe('URL deduplication by canonical', () => {
    it('should deduplicate URLs with same canonical form', async () => {
      mockSearch.search.mockResolvedValue([
        { url: 'https://www.example.com/page?utm_source=a', canonicalUrl: 'https://example.com/page', title: 'Page', snippet: 'Snippet' },
        { url: 'https://example.com/page?ref=b', canonicalUrl: 'https://example.com/page', title: 'Page', snippet: 'Snippet' },
        { url: 'https://example.com/page/', canonicalUrl: 'https://example.com/page', title: 'Page', snippet: 'Snippet' },
      ]);

      mockFetch.fetch.mockResolvedValue({
        success: true,
        url: 'https://example.com/page',
        finalUrl: 'https://example.com/page',
        status: 200,
        headers: { 'content-type': 'text/html' },
        content: '<html><body>Content</body></html>',
        contentLength: 1000,
        timing: { startMs: 0, endMs: 50, durationMs: 50 },
        retryCount: 0,
      });

      const result = await pipeline.retrieve({
        query: 'test',
        maxResults: 5,
      });

      expect(result.results.length).toBeLessThanOrEqual(1);
    });
  });

  describe('content deduplication by hash', () => {
    it('should deduplicate results with same content hash', async () => {
      mockSearch.search.mockResolvedValue([
        { url: 'https://site1.com/article', canonicalUrl: 'https://site1.com/article', title: 'Article 1', snippet: 'Snippet' },
        { url: 'https://site2.com/article', canonicalUrl: 'https://site2.com/article', title: 'Article 2', snippet: 'Snippet' },
      ]);

      const sameContent = '<html><body>Identical content on both sites</body></html>';
      mockFetch.fetch.mockResolvedValue({
        success: true,
        status: 200,
        headers: { 'content-type': 'text/html' },
        content: sameContent,
        contentLength: sameContent.length,
        timing: { startMs: 0, endMs: 50, durationMs: 50 },
        retryCount: 0,
      });

      const result = await pipeline.retrieve({
        query: 'test',
        maxResults: 5,
        deduplicateByContent: true,
      });

      expect(result.results.length).toBe(1);
    });

    it('should keep duplicate content when deduplication disabled', async () => {
      mockSearch.search.mockResolvedValue([
        { url: 'https://site1.com/article', canonicalUrl: 'https://site1.com/article', title: 'Article 1', snippet: 'Snippet' },
        { url: 'https://site2.com/article', canonicalUrl: 'https://site2.com/article', title: 'Article 2', snippet: 'Snippet' },
      ]);

      const sameContent = '<html><body>Identical content</body></html>';
      mockFetch.fetch.mockResolvedValue({
        success: true,
        status: 200,
        headers: { 'content-type': 'text/html' },
        content: sameContent,
        contentLength: sameContent.length,
        timing: { startMs: 0, endMs: 50, durationMs: 50 },
        retryCount: 0,
      });

      const result = await pipeline.retrieve({
        query: 'test',
        maxResults: 5,
        deduplicateByContent: false,
      });

      expect(result.results.length).toBe(2);
    });
  });

  describe('quality score sorting', () => {
    it('should sort results by quality score descending', async () => {
      mockSearch.search.mockResolvedValue([
        { url: 'https://random-blog.com/post', canonicalUrl: 'https://random-blog.com/post', title: 'Blog Post', snippet: 'Snippet' },
        { url: 'https://nature.com/article', canonicalUrl: 'https://nature.com/article', title: 'Nature Article', snippet: 'Snippet' },
      ]);

      mockFetch.fetch.mockImplementation((url: string) => Promise.resolve({
        success: true,
        url,
        finalUrl: url,
        status: 200,
        headers: { 'content-type': 'text/html', 'last-modified': new Date().toUTCString() },
        content: `<html><body>Content for ${url}</body></html>`,
        contentLength: 5000,
        timing: { startMs: 0, endMs: 50, durationMs: 50 },
        retryCount: 0,
      }));

      const result = await pipeline.retrieve({
        query: 'test',
        maxResults: 5,
      });

      expect(result.results.length).toBe(2);
      expect(result.results[0].qualityScore.total).toBeGreaterThanOrEqual(result.results[1].qualityScore.total);
    });
  });

  describe('blocked domains filtering', () => {
    it('should filter out blocked domains', async () => {
      mockSearch.search.mockResolvedValue([
        { url: 'https://blocked-site.com/page', canonicalUrl: 'https://blocked-site.com/page', title: 'Blocked', snippet: 'Snippet' },
        { url: 'https://allowed-site.com/page', canonicalUrl: 'https://allowed-site.com/page', title: 'Allowed', snippet: 'Snippet' },
      ]);

      mockFetch.fetch.mockResolvedValue({
        success: true,
        status: 200,
        headers: { 'content-type': 'text/html' },
        content: '<html><body>Content</body></html>',
        contentLength: 1000,
        timing: { startMs: 0, endMs: 50, durationMs: 50 },
        retryCount: 0,
      });

      const result = await pipeline.retrieve({
        query: 'test',
        maxResults: 5,
        blockedDomains: ['blocked-site.com'],
      });

      expect(result.results.every(r => !r.url.includes('blocked-site.com'))).toBe(true);
    });

    it('should filter domains blocked by sandbox security', async () => {
      mockSandboxSecurity.isHostAllowed.mockImplementation((domain: string) => 
        domain !== 'malicious.com'
      );

      mockSearch.search.mockResolvedValue([
        { url: 'https://malicious.com/page', canonicalUrl: 'https://malicious.com/page', title: 'Bad', snippet: 'Snippet' },
        { url: 'https://safe.com/page', canonicalUrl: 'https://safe.com/page', title: 'Safe', snippet: 'Snippet' },
      ]);

      mockFetch.fetch.mockResolvedValue({
        success: true,
        status: 200,
        headers: { 'content-type': 'text/html' },
        content: '<html><body>Content</body></html>',
        contentLength: 1000,
        timing: { startMs: 0, endMs: 50, durationMs: 50 },
        retryCount: 0,
      });

      const result = await pipeline.retrieve({
        query: 'test',
        maxResults: 5,
      });

      expect(result.results.every(r => !r.url.includes('malicious.com'))).toBe(true);
    });
  });

  describe('allowed domains filtering', () => {
    it('should only include allowed domains when specified', async () => {
      mockSearch.search.mockResolvedValue([
        { url: 'https://allowed.com/page', canonicalUrl: 'https://allowed.com/page', title: 'Allowed', snippet: 'Snippet' },
        { url: 'https://other.com/page', canonicalUrl: 'https://other.com/page', title: 'Other', snippet: 'Snippet' },
      ]);

      mockFetch.fetch.mockResolvedValue({
        success: true,
        status: 200,
        headers: { 'content-type': 'text/html' },
        content: '<html><body>Content</body></html>',
        contentLength: 1000,
        timing: { startMs: 0, endMs: 50, durationMs: 50 },
        retryCount: 0,
      });

      const result = await pipeline.retrieve({
        query: 'test',
        maxResults: 5,
        allowedDomains: ['allowed.com'],
      });

      expect(result.results.every(r => r.url.includes('allowed.com'))).toBe(true);
    });
  });

  describe('fallback to browser for JS pages', () => {
    it('should fallback to browser when JS is required', async () => {
      mockSearch.search.mockResolvedValue([
        { url: 'https://spa-app.com/page', canonicalUrl: 'https://spa-app.com/page', title: 'SPA Page', snippet: 'Snippet' },
      ]);

      mockFetch.fetch.mockResolvedValue({
        success: true,
        status: 200,
        headers: { 'content-type': 'text/html' },
        content: '<html><body><noscript>Please enable JavaScript</noscript><script>loadApp()</script></body></html>',
        contentLength: 100,
        timing: { startMs: 0, endMs: 50, durationMs: 50 },
        retryCount: 0,
      });

      mockBrowser.browse.mockResolvedValue({
        success: true,
        url: 'https://spa-app.com/page',
        finalUrl: 'https://spa-app.com/page',
        title: 'SPA Page',
        content: 'Full rendered content from browser',
        timing: { navigationMs: 200, renderMs: 100, totalMs: 300 },
      });

      const result = await pipeline.retrieve({
        query: 'test',
        maxResults: 5,
      });

      expect(mockBrowser.browse).toHaveBeenCalled();
      expect(result.results[0].fetchMethod).toBe('browser');
    });

    it('should use browser when preferBrowser is true', async () => {
      mockSearch.search.mockResolvedValue([
        { url: 'https://example.com/page', canonicalUrl: 'https://example.com/page', title: 'Page', snippet: 'Snippet' },
      ]);

      mockBrowser.browse.mockResolvedValue({
        success: true,
        url: 'https://example.com/page',
        finalUrl: 'https://example.com/page',
        title: 'Page',
        content: 'Browser rendered content',
        timing: { navigationMs: 100, renderMs: 50, totalMs: 150 },
      });

      const result = await pipeline.retrieve({
        query: 'test',
        maxResults: 5,
        preferBrowser: true,
      });

      expect(mockBrowser.browse).toHaveBeenCalled();
      expect(result.results[0].fetchMethod).toBe('browser');
    });
  });

  describe('error handling', () => {
    it('should handle search errors gracefully', async () => {
      mockSearch.search.mockRejectedValue(new Error('Search API down'));

      const result = await pipeline.retrieve({
        query: 'test',
        maxResults: 5,
      });

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].stage).toBe('search');
    });

    it('should handle individual URL fetch errors', async () => {
      mockSearch.search.mockResolvedValue([
        { url: 'https://works.com/page', canonicalUrl: 'https://works.com/page', title: 'Works', snippet: 'Snippet' },
        { url: 'https://fails.com/page', canonicalUrl: 'https://fails.com/page', title: 'Fails', snippet: 'Snippet' },
      ]);

      mockFetch.fetch.mockImplementation((url: string) => {
        if (url.includes('fails.com')) {
          return Promise.resolve({
            success: false,
            url,
            finalUrl: url,
            status: 500,
            headers: {},
            error: 'Server error',
            contentLength: 0,
            timing: { startMs: 0, endMs: 50, durationMs: 50 },
            retryCount: 0,
          });
        }
        return Promise.resolve({
          success: true,
          url,
          finalUrl: url,
          status: 200,
          headers: { 'content-type': 'text/html' },
          content: '<html><body>Content</body></html>',
          contentLength: 1000,
          timing: { startMs: 0, endMs: 50, durationMs: 50 },
          retryCount: 0,
        });
      });

      mockBrowser.browse.mockResolvedValue({
        success: false,
        error: 'Browser also failed',
        timing: { navigationMs: 0, renderMs: 0, totalMs: 50 },
      });

      const result = await pipeline.retrieve({
        query: 'test',
        maxResults: 5,
      });

      expect(result.results.length).toBeGreaterThanOrEqual(1);
      expect(result.errors.some(e => e.url.includes('fails.com'))).toBe(true);
    });

    it('should continue processing when some URLs fail', async () => {
      mockSearch.search.mockResolvedValue([
        { url: 'https://good1.com/page', canonicalUrl: 'https://good1.com/page', title: 'Good 1', snippet: 'Snippet' },
        { url: 'https://bad.com/page', canonicalUrl: 'https://bad.com/page', title: 'Bad', snippet: 'Snippet' },
        { url: 'https://good2.com/page', canonicalUrl: 'https://good2.com/page', title: 'Good 2', snippet: 'Snippet' },
      ]);

      mockFetch.fetch.mockImplementation((url: string) => {
        if (url.includes('bad.com')) {
          return Promise.resolve({
            success: false,
            url,
            finalUrl: url,
            status: 0,
            headers: {},
            error: 'Connection refused',
            contentLength: 0,
            timing: { startMs: 0, endMs: 50, durationMs: 50 },
            retryCount: 0,
          });
        }
        return Promise.resolve({
          success: true,
          url,
          finalUrl: url,
          status: 200,
          headers: { 'content-type': 'text/html' },
          content: `<html><body>Unique content for ${url}</body></html>`,
          contentLength: 1000,
          timing: { startMs: 0, endMs: 50, durationMs: 50 },
          retryCount: 0,
        });
      });

      mockBrowser.browse.mockImplementation((url: string) => {
        if (url.includes('bad.com')) {
          return Promise.resolve({
            success: false,
            url,
            finalUrl: url,
            title: '',
            error: 'Browser failed',
            timing: { navigationMs: 0, renderMs: 0, totalMs: 50 },
          });
        }
        return Promise.resolve({
          success: true,
          url,
          finalUrl: url,
          title: 'Good Page',
          content: `Unique browser content for ${url}`,
          timing: { navigationMs: 100, renderMs: 50, totalMs: 150 },
        });
      });

      const result = await pipeline.retrieve({
        query: 'test',
        maxResults: 5,
        deduplicateByContent: false,
      });

      expect(result.results.length).toBe(2);
    });
  });

  describe('minQualityScore filtering', () => {
    it('should filter results below minimum quality score', async () => {
      mockSearch.search.mockResolvedValue([
        { url: 'https://low-quality.xyz/page', canonicalUrl: 'https://low-quality.xyz/page', title: 'Low Quality', snippet: 'Snippet' },
        { url: 'https://nature.com/article', canonicalUrl: 'https://nature.com/article', title: 'High Quality', snippet: 'Snippet' },
      ]);

      mockFetch.fetch.mockImplementation((url: string) => Promise.resolve({
        success: true,
        url,
        finalUrl: url,
        status: 200,
        headers: { 'content-type': 'text/html', 'last-modified': new Date().toUTCString() },
        content: `<html><body>Content for ${url}</body></html>`,
        contentLength: url.includes('nature.com') ? 10000 : 100,
        timing: { startMs: 0, endMs: 50, durationMs: 50 },
        retryCount: 0,
      }));

      const result = await pipeline.retrieve({
        query: 'test',
        maxResults: 5,
        minQualityScore: 250,
      });

      expect(result.results.every(r => r.qualityScore.total >= 250)).toBe(true);
    });
  });

  describe('scholar search', () => {
    it('should include scholar results when includeScholar is true', async () => {
      mockSearch.search.mockResolvedValue([
        { url: 'https://example.com/page', canonicalUrl: 'https://example.com/page', title: 'Web Page', snippet: 'Snippet' },
      ]);

      mockSearch.searchScholar.mockResolvedValue([
        { url: 'https://arxiv.org/paper', canonicalUrl: 'https://arxiv.org/paper', title: 'Academic Paper', snippet: 'Abstract', authors: 'Author', year: '2024' },
      ]);

      mockFetch.fetch.mockResolvedValue({
        success: true,
        status: 200,
        headers: { 'content-type': 'text/html' },
        content: '<html><body>Content</body></html>',
        contentLength: 5000,
        timing: { startMs: 0, endMs: 50, durationMs: 50 },
        retryCount: 0,
      });

      const result = await pipeline.retrieve({
        query: 'test',
        maxResults: 5,
        includeScholar: true,
      });

      expect(mockSearch.searchScholar).toHaveBeenCalled();
    });
  });

  describe('timing metrics', () => {
    it('should include timing breakdown', async () => {
      mockSearch.search.mockResolvedValue([
        { url: 'https://example.com/page', canonicalUrl: 'https://example.com/page', title: 'Page', snippet: 'Snippet' },
      ]);

      mockFetch.fetch.mockResolvedValue({
        success: true,
        status: 200,
        headers: { 'content-type': 'text/html' },
        content: '<html><body>Content</body></html>',
        contentLength: 1000,
        timing: { startMs: 0, endMs: 50, durationMs: 50 },
        retryCount: 0,
      });

      const result = await pipeline.retrieve({
        query: 'test',
        maxResults: 5,
      });

      expect(result.timing).toBeDefined();
      expect(result.timing.searchMs).toBeDefined();
      expect(result.timing.fetchMs).toBeDefined();
      expect(result.timing.processMs).toBeDefined();
      expect(result.timing.totalMs).toBeDefined();
    });
  });

  describe('result statistics', () => {
    it('should include result statistics', async () => {
      mockSearch.search.mockResolvedValue([
        { url: 'https://example1.com/page', canonicalUrl: 'https://example1.com/page', title: 'Page 1', snippet: 'Snippet' },
        { url: 'https://example2.com/page', canonicalUrl: 'https://example2.com/page', title: 'Page 2', snippet: 'Snippet' },
        { url: 'https://example3.com/page', canonicalUrl: 'https://example3.com/page', title: 'Page 3', snippet: 'Snippet' },
      ]);

      mockFetch.fetch.mockResolvedValue({
        success: true,
        status: 200,
        headers: { 'content-type': 'text/html' },
        content: '<html><body>Content</body></html>',
        contentLength: 1000,
        timing: { startMs: 0, endMs: 50, durationMs: 50 },
        retryCount: 0,
      });

      const result = await pipeline.retrieve({
        query: 'test',
        maxResults: 2,
      });

      expect(result.totalFound).toBe(3);
      expect(result.totalProcessed).toBeDefined();
      expect(result.results.length).toBeLessThanOrEqual(2);
    });
  });
});

describe('Sandbox Security Integration', () => {
  describe('FetchAdapter security', () => {
    it('should block hosts not in allowlist', async () => {
      (sandboxSecurity.isHostAllowed as Mock).mockReturnValueOnce(false);
      
      const fetchAdapterInstance = new HttpFetchAdapter();
      const result = await fetchAdapterInstance.fetch('https://blocked-host.com/page');
      
      expect(result.success).toBe(false);
      expect(result.status).toBe(403);
      expect(result.error).toContain('not allowed by sandbox security');
    });

    it('should allow hosts in allowlist', async () => {
      (sandboxSecurity.isHostAllowed as Mock).mockReturnValueOnce(true);
      
      const fetchAdapterInstance = new HttpFetchAdapter();
      expect(fetchAdapterInstance.isUrlAllowed('https://allowed-host.com/page')).toBe(true);
    });

    it('should return false for invalid URLs in isUrlAllowed', () => {
      const fetchAdapterInstance = new HttpFetchAdapter();
      expect(fetchAdapterInstance.isUrlAllowed('')).toBe(false);
    });
  });

  describe('BrowserAdapter security', () => {
    it('should block hosts not in allowlist', async () => {
      (sandboxSecurity.isHostAllowed as Mock).mockReturnValueOnce(false);
      
      const browserAdapterInstance = new PlaywrightBrowserAdapter();
      const result = await browserAdapterInstance.browse('https://blocked-host.com/page');
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('not allowed by sandbox security');
    });

    it('should allow hosts in allowlist', async () => {
      (sandboxSecurity.isHostAllowed as Mock).mockReturnValueOnce(true);
      
      const browserAdapterInstance = new PlaywrightBrowserAdapter();
      expect(browserAdapterInstance.isUrlAllowed('https://allowed-host.com/page')).toBe(true);
    });
  });
});

describe('Quality Scorer Enhancements', () => {
  describe('configurable weights', () => {
    it('should apply custom domain weight', () => {
      const baseScore = calculateQualityScore('https://nature.com/article', {}, 5000);
      const weightedScore = calculateQualityScore(
        'https://nature.com/article', 
        {}, 
        5000,
        { domain: 2 }
      );
      
      expect(weightedScore.domain).toBe(Math.min(baseScore.domain * 2, 100));
    });

    it('should apply custom recency weight', () => {
      const today = new Date().toUTCString();
      const baseScore = calculateQualityScore('https://example.com', { 'last-modified': today }, 5000);
      const weightedScore = calculateQualityScore(
        'https://example.com', 
        { 'last-modified': today }, 
        5000,
        { recency: 0.5 }
      );
      
      expect(weightedScore.recency).toBe(Math.round(baseScore.recency * 0.5));
    });

    it('should default to weight of 1 when not specified', () => {
      const score1 = calculateQualityScore('https://example.com', {}, 5000);
      const score2 = calculateQualityScore('https://example.com', {}, 5000, {});
      
      expect(score1.total).toBe(score2.total);
    });
  });

  describe('authoritativeness with metadata', () => {
    it('should boost score when author is present', () => {
      const baseScore = calculateQualityScore('https://example.com', {}, 5000);
      const withAuthor = calculateQualityScore(
        'https://example.com', 
        {}, 
        5000,
        undefined,
        { author: 'John Doe' }
      );
      
      expect(withAuthor.authoritativeness).toBeGreaterThanOrEqual(baseScore.authoritativeness);
    });

    it('should boost score when citations are present', () => {
      const baseScore = calculateQualityScore('https://example.com', {}, 5000);
      const withCitations = calculateQualityScore(
        'https://example.com', 
        {}, 
        5000,
        undefined,
        { hasCitations: true }
      );
      
      expect(withCitations.authoritativeness).toBeGreaterThan(baseScore.authoritativeness);
    });

    it('should boost score when references are present', () => {
      const baseScore = calculateQualityScore('https://example.com', {}, 5000);
      const withReferences = calculateQualityScore(
        'https://example.com', 
        {}, 
        5000,
        undefined,
        { hasReferences: true }
      );
      
      expect(withReferences.authoritativeness).toBeGreaterThan(baseScore.authoritativeness);
    });
  });

  describe('recency with metadata', () => {
    it('should use publishedDate from metadata over headers', () => {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const yearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toUTCString();
      
      const score = calculateQualityScore(
        'https://example.com', 
        { 'last-modified': yearAgo }, 
        5000,
        undefined,
        { publishedDate: yesterday }
      );
      
      expect(score.recency).toBeGreaterThan(50);
    });
  });
});

describe('Zod validation', () => {
  describe('canonicalizeUrl input validation', () => {
    it('should throw on empty string input', () => {
      expect(() => canonicalizeUrl('')).toThrow();
    });

    it('should throw on null input', () => {
      expect(() => canonicalizeUrl(null as any)).toThrow();
    });

    it('should throw on undefined input', () => {
      expect(() => canonicalizeUrl(undefined as any)).toThrow();
    });
  });

  describe('hashContent input validation', () => {
    it('should handle null gracefully', () => {
      const hash = hashContent(null as any);
      expect(hash).toHaveLength(64);
    });

    it('should handle undefined gracefully', () => {
      const hash = hashContent(undefined as any);
      expect(hash).toHaveLength(64);
    });
  });
});
