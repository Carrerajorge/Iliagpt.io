import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ResponseCache, type CacheEntry } from "../webtool/responseCache";

describe("ResponseCache Tenant Isolation", () => {
  let cache: ResponseCache;
  
  beforeEach(() => {
    cache = new ResponseCache({
      maxEntries: 100,
      defaultTtlMs: 60000,
      cleanupIntervalMs: 1000000,
    });
  });
  
  afterEach(() => {
    cache.destroy();
  });

  describe("Tenant Data Isolation", () => {
    it("should isolate cache entries between different tenants", () => {
      const url = "https://example.com/shared-url";
      
      cache.set(url, "Tenant A content", { fetchMethod: "fetch", tenantId: "tenant-a" });
      cache.set(url, "Tenant B content", { fetchMethod: "fetch", tenantId: "tenant-b" });
      
      const entryA = cache.get(url, undefined, "tenant-a");
      const entryB = cache.get(url, undefined, "tenant-b");
      
      expect(entryA?.content).toBe("Tenant A content");
      expect(entryB?.content).toBe("Tenant B content");
      expect(entryA?.content).not.toBe(entryB?.content);
    });

    it("should prevent tenant A from accessing tenant B's cached data", () => {
      cache.set("https://example.com/secret", "Secret B Data", { 
        fetchMethod: "fetch", 
        tenantId: "tenant-b" 
      });
      
      const attemptedAccess = cache.get("https://example.com/secret", undefined, "tenant-a");
      
      expect(attemptedAccess).toBeNull();
    });

    it("should allow same URL to be cached independently per tenant", () => {
      const url = "https://api.example.com/user/profile";
      
      cache.set(url, '{"name": "Alice", "id": 1}', { fetchMethod: "fetch", tenantId: "user-1" });
      cache.set(url, '{"name": "Bob", "id": 2}', { fetchMethod: "fetch", tenantId: "user-2" });
      cache.set(url, '{"name": "Charlie", "id": 3}', { fetchMethod: "fetch", tenantId: "user-3" });
      
      expect(cache.get(url, undefined, "user-1")?.content).toBe('{"name": "Alice", "id": 1}');
      expect(cache.get(url, undefined, "user-2")?.content).toBe('{"name": "Bob", "id": 2}');
      expect(cache.get(url, undefined, "user-3")?.content).toBe('{"name": "Charlie", "id": 3}');
    });

    it("should not allow access to tenant data without providing tenantId", () => {
      cache.set("https://example.com/data", "Tenant specific data", { 
        fetchMethod: "fetch", 
        tenantId: "tenant-x" 
      });
      
      const globalAccess = cache.get("https://example.com/data");
      
      expect(globalAccess).toBeNull();
    });
  });

  describe("Global Cache Independence", () => {
    it("should keep global cache separate from tenant-specific cache", () => {
      const url = "https://example.com/resource";
      
      cache.set(url, "Global content", { fetchMethod: "fetch" });
      cache.set(url, "Tenant content", { fetchMethod: "fetch", tenantId: "tenant-1" });
      
      const globalEntry = cache.get(url);
      const tenantEntry = cache.get(url, undefined, "tenant-1");
      
      expect(globalEntry?.content).toBe("Global content");
      expect(tenantEntry?.content).toBe("Tenant content");
    });

    it("should not expose global cache entries to tenants", () => {
      cache.set("https://example.com/global", "Global only data", { fetchMethod: "fetch" });
      
      const tenantAccess = cache.get("https://example.com/global", undefined, "some-tenant");
      
      expect(tenantAccess).toBeNull();
    });

    it("should not expose tenant entries when accessing without tenantId", () => {
      cache.set("https://example.com/tenant-data", "Tenant data", { 
        fetchMethod: "fetch", 
        tenantId: "tenant-1" 
      });
      
      const globalAccess = cache.get("https://example.com/tenant-data");
      
      expect(globalAccess).toBeNull();
    });

    it("should maintain separate hit/miss counts for global vs tenant access", () => {
      const url = "https://example.com/stats-test";
      
      cache.set(url, "Global", { fetchMethod: "fetch" });
      cache.set(url, "TenantA", { fetchMethod: "fetch", tenantId: "tenant-a" });
      
      cache.get(url);
      cache.get(url);
      cache.get(url, undefined, "tenant-a");
      cache.get("https://nonexistent.com", undefined, "tenant-a");
      
      const stats = cache.getStats();
      const tenantStats = cache.getStatsByTenant("tenant-a");
      
      expect(stats.hits).toBeGreaterThan(0);
      expect(tenantStats.hits).toBe(1);
      expect(tenantStats.misses).toBe(1);
    });
  });

  describe("invalidateByTenant", () => {
    it("should only remove entries for the specified tenant", () => {
      cache.set("https://example.com/1", "TenantA-1", { fetchMethod: "fetch", tenantId: "tenant-a" });
      cache.set("https://example.com/2", "TenantA-2", { fetchMethod: "fetch", tenantId: "tenant-a" });
      cache.set("https://example.com/3", "TenantB-1", { fetchMethod: "fetch", tenantId: "tenant-b" });
      cache.set("https://example.com/4", "Global", { fetchMethod: "fetch" });
      
      const invalidatedCount = cache.invalidateByTenant("tenant-a");
      
      expect(invalidatedCount).toBe(2);
      expect(cache.get("https://example.com/1", undefined, "tenant-a")).toBeNull();
      expect(cache.get("https://example.com/2", undefined, "tenant-a")).toBeNull();
      expect(cache.get("https://example.com/3", undefined, "tenant-b")).not.toBeNull();
      expect(cache.get("https://example.com/4")).not.toBeNull();
    });

    it("should return 0 when invalidating non-existent tenant", () => {
      cache.set("https://example.com/data", "Some data", { fetchMethod: "fetch", tenantId: "existing-tenant" });
      
      const count = cache.invalidateByTenant("non-existent-tenant");
      
      expect(count).toBe(0);
    });

    it("should not affect other tenants when invalidating one", () => {
      const tenants = ["t1", "t2", "t3"];
      
      for (const tenant of tenants) {
        cache.set(`https://example.com/${tenant}`, `Data for ${tenant}`, { 
          fetchMethod: "fetch", 
          tenantId: tenant 
        });
      }
      
      cache.invalidateByTenant("t2");
      
      expect(cache.get("https://example.com/t1", undefined, "t1")).not.toBeNull();
      expect(cache.get("https://example.com/t2", undefined, "t2")).toBeNull();
      expect(cache.get("https://example.com/t3", undefined, "t3")).not.toBeNull();
    });

    it("should clean up tenant stats after invalidation", () => {
      cache.set("https://example.com/data", "Data", { fetchMethod: "fetch", tenantId: "cleanup-tenant" });
      cache.get("https://example.com/data", undefined, "cleanup-tenant");
      
      let stats = cache.getStatsByTenant("cleanup-tenant");
      expect(stats.hits).toBe(1);
      expect(stats.entries).toBe(1);
      
      cache.invalidateByTenant("cleanup-tenant");
      
      stats = cache.getStatsByTenant("cleanup-tenant");
      expect(stats.entries).toBe(0);
      expect(stats.hits).toBe(0);
    });
  });

  describe("getStatsByTenant", () => {
    it("should return correct per-tenant metrics", () => {
      cache.set("https://example.com/1", "A".repeat(1000), { fetchMethod: "fetch", tenantId: "stats-tenant" });
      cache.set("https://example.com/2", "B".repeat(2000), { fetchMethod: "fetch", tenantId: "stats-tenant" });
      cache.set("https://example.com/other", "Other", { fetchMethod: "fetch", tenantId: "other-tenant" });
      
      cache.get("https://example.com/1", undefined, "stats-tenant");
      cache.get("https://example.com/1", undefined, "stats-tenant");
      cache.get("https://example.com/missing", undefined, "stats-tenant");
      
      const stats = cache.getStatsByTenant("stats-tenant");
      
      expect(stats.tenantId).toBe("stats-tenant");
      expect(stats.entries).toBe(2);
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(1);
      expect(stats.hitRate).toBeCloseTo(2/3, 2);
      expect(stats.memoryUsageMb).toBeGreaterThan(0);
    });

    it("should return zero stats for non-existent tenant", () => {
      const stats = cache.getStatsByTenant("ghost-tenant");
      
      expect(stats.entries).toBe(0);
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(stats.hitRate).toBe(0);
    });

    it("should not include expired entries in tenant stats", async () => {
      cache = new ResponseCache({
        maxEntries: 100,
        fetchTtlMs: 50,
        cleanupIntervalMs: 1000000,
      });
      
      cache.set("https://example.com/expiring", "Will expire", { 
        fetchMethod: "fetch", 
        tenantId: "expiry-tenant" 
      });
      
      let stats = cache.getStatsByTenant("expiry-tenant");
      expect(stats.entries).toBe(1);
      
      await new Promise(r => setTimeout(r, 100));
      
      stats = cache.getStatsByTenant("expiry-tenant");
      expect(stats.entries).toBe(0);
    });

    it("should track stats independently per tenant", () => {
      cache.set("https://example.com/a", "DataA", { fetchMethod: "fetch", tenantId: "tenant-alpha" });
      cache.set("https://example.com/b", "DataB", { fetchMethod: "fetch", tenantId: "tenant-beta" });
      
      cache.get("https://example.com/a", undefined, "tenant-alpha");
      cache.get("https://example.com/a", undefined, "tenant-alpha");
      cache.get("https://example.com/a", undefined, "tenant-alpha");
      cache.get("https://example.com/b", undefined, "tenant-beta");
      
      const alphaStats = cache.getStatsByTenant("tenant-alpha");
      const betaStats = cache.getStatsByTenant("tenant-beta");
      
      expect(alphaStats.hits).toBe(3);
      expect(betaStats.hits).toBe(1);
    });
  });

  describe("Backward Compatibility", () => {
    it("should work without tenantId (global cache)", () => {
      cache.set("https://example.com/page", "Content", { fetchMethod: "fetch" });
      
      const entry = cache.get("https://example.com/page");
      
      expect(entry?.content).toBe("Content");
    });

    it("should support all existing methods without tenantId", () => {
      cache.set("https://example.com/test", "Test content", { 
        fetchMethod: "fetch",
        etag: '"abc"',
        lastModified: "Wed, 01 Jan 2025 00:00:00 GMT",
        queryHash: "query123"
      });
      
      const headers = cache.getConditionalHeaders("https://example.com/test");
      expect(headers).not.toBeNull();
      expect(headers!["If-None-Match"]).toBe('"abc"');
      
      const entry = cache.handleNotModified("https://example.com/test", 120000);
      expect(entry).not.toBeNull();
      
      const byQuery = cache.getByQuery("query123");
      expect(byQuery.length).toBe(1);
      
      const stats = cache.getStats();
      expect(stats.entries).toBe(1);
    });

    it("should maintain existing invalidate behavior", () => {
      cache.set("https://example.com/to-invalidate", "Content", { fetchMethod: "fetch" });
      
      expect(cache.get("https://example.com/to-invalidate")).not.toBeNull();
      
      const result = cache.invalidate("https://example.com/to-invalidate");
      
      expect(result).toBe(true);
      expect(cache.get("https://example.com/to-invalidate")).toBeNull();
    });
  });

  describe("PII Redaction", () => {
    it("should hash tenant IDs for cache keys", () => {
      const tenantId = "user@example.com";
      const hashedTenant = ResponseCache.hashTenantId(tenantId);
      
      expect(hashedTenant.length).toBe(12);
      expect(hashedTenant).not.toContain("@");
      expect(hashedTenant).not.toContain("example.com");
    });

    it("should generate consistent hashes for same tenant ID", () => {
      const hash1 = ResponseCache.hashTenantId("user-123");
      const hash2 = ResponseCache.hashTenantId("user-123");
      
      expect(hash1).toBe(hash2);
    });

    it("should generate different hashes for different tenant IDs", () => {
      const hash1 = ResponseCache.hashTenantId("user-123");
      const hash2 = ResponseCache.hashTenantId("user-456");
      
      expect(hash1).not.toBe(hash2);
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty tenant ID gracefully", () => {
      cache.set("https://example.com/empty", "Content", { fetchMethod: "fetch", tenantId: "" });
      
      const entry = cache.get("https://example.com/empty", undefined, "");
      expect(entry?.content).toBe("Content");
    });

    it("should handle special characters in tenant ID", () => {
      const tenantId = "user/with:special@chars#!";
      
      cache.set("https://example.com/special", "Special content", { 
        fetchMethod: "fetch", 
        tenantId 
      });
      
      const entry = cache.get("https://example.com/special", undefined, tenantId);
      expect(entry?.content).toBe("Special content");
    });

    it("should respect memory limits across tenants", () => {
      cache = new ResponseCache({
        maxEntries: 100,
        maxMemoryMb: 0.001,
        maxContentSizeBytes: 1000,
        cleanupIntervalMs: 1000000,
      });
      
      cache.set("https://example.com/1", "a".repeat(500), { fetchMethod: "fetch", tenantId: "t1" });
      cache.set("https://example.com/2", "b".repeat(500), { fetchMethod: "fetch", tenantId: "t2" });
      cache.set("https://example.com/3", "c".repeat(500), { fetchMethod: "fetch", tenantId: "t3" });
      
      const stats = cache.getStats();
      expect(stats.entries).toBeLessThan(3);
    });

    it("should handle concurrent access patterns", () => {
      const tenants = ["t1", "t2", "t3"];
      const url = "https://example.com/concurrent";
      
      for (const tenant of tenants) {
        cache.set(url, `Content for ${tenant}`, { fetchMethod: "fetch", tenantId: tenant });
      }
      
      const results = tenants.map(t => cache.get(url, undefined, t)?.content);
      
      expect(results).toEqual([
        "Content for t1",
        "Content for t2", 
        "Content for t3"
      ]);
    });
  });
});
