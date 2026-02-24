/**
 * Edge Caching Service - ILIAGPT PRO 3.0
 * 
 * CDN-like caching at the edge for low latency.
 * Multi-region support with intelligent routing.
 */

// ============== Types ==============

export interface EdgeConfig {
    regions: EdgeRegion[];
    defaultTTL: number;
    maxCacheSize: number;
    replicationStrategy: "lazy" | "eager" | "selective";
}

export interface EdgeRegion {
    id: string;
    name: string;
    location: { lat: number; lng: number };
    endpoint: string;
    priority: number;
}

export interface CacheEntry<T = any> {
    key: string;
    value: T;
    hash: string;
    ttl: number;
    createdAt: number;
    lastAccessed: number;
    accessCount: number;
    size: number;
    regions: string[];
}

export interface CacheStats {
    hits: number;
    misses: number;
    hitRate: number;
    totalSize: number;
    entryCount: number;
    avgLatency: number;
    regionStats: Record<string, { hits: number; latency: number }>;
}

// ============== Edge Cache Service ==============

export class EdgeCachingService {
    private config: EdgeConfig;
    private cache: Map<string, CacheEntry> = new Map();
    private stats: CacheStats = {
        hits: 0,
        misses: 0,
        hitRate: 0,
        totalSize: 0,
        entryCount: 0,
        avgLatency: 0,
        regionStats: {},
    };

    constructor(config?: Partial<EdgeConfig>) {
        this.config = {
            regions: config?.regions || [
                { id: "us-east", name: "US East", location: { lat: 37.7749, lng: -122.4194 }, endpoint: "https://us-east.edge.example.com", priority: 1 },
                { id: "us-west", name: "US West", location: { lat: 40.7128, lng: -74.0060 }, endpoint: "https://us-west.edge.example.com", priority: 2 },
                { id: "eu-west", name: "EU West", location: { lat: 51.5074, lng: -0.1278 }, endpoint: "https://eu-west.edge.example.com", priority: 3 },
                { id: "asia-east", name: "Asia East", location: { lat: 35.6762, lng: 139.6503 }, endpoint: "https://asia-east.edge.example.com", priority: 4 },
            ],
            defaultTTL: config?.defaultTTL || 3600000, // 1 hour
            maxCacheSize: config?.maxCacheSize || 100 * 1024 * 1024, // 100MB
            replicationStrategy: config?.replicationStrategy || "lazy",
        };
    }

    // ======== Cache Operations ========

    /**
     * Get from cache with edge routing
     */
    async get<T>(key: string, options?: {
        region?: string;
        fallback?: () => Promise<T>;
    }): Promise<{ value: T; fromCache: boolean; region: string; latency: number } | null> {
        const startTime = Date.now();
        const region = options?.region || this.selectBestRegion();

        const entry = this.cache.get(key);

        if (entry && !this.isExpired(entry)) {
            entry.lastAccessed = Date.now();
            entry.accessCount++;

            const latency = Date.now() - startTime;
            this.recordHit(region, latency);

            return {
                value: entry.value as T,
                fromCache: true,
                region,
                latency,
            };
        }

        // Cache miss
        this.stats.misses++;

        if (options?.fallback) {
            const value = await options.fallback();
            await this.set(key, value, { region });

            const latency = Date.now() - startTime;
            return {
                value,
                fromCache: false,
                region,
                latency,
            };
        }

        return null;
    }

    /**
     * Set in cache
     */
    async set<T>(key: string, value: T, options?: {
        ttl?: number;
        region?: string;
        replicate?: boolean;
    }): Promise<void> {
        const size = this.calculateSize(value);

        // Evict if needed
        while (this.stats.totalSize + size > this.config.maxCacheSize) {
            this.evictLRU();
        }

        const entry: CacheEntry<T> = {
            key,
            value,
            hash: this.hash(JSON.stringify(value)),
            ttl: options?.ttl || this.config.defaultTTL,
            createdAt: Date.now(),
            lastAccessed: Date.now(),
            accessCount: 0,
            size,
            regions: [options?.region || this.selectBestRegion()],
        };

        this.cache.set(key, entry);
        this.stats.totalSize += size;
        this.stats.entryCount = this.cache.size;

        // Replicate if needed
        if (options?.replicate !== false) {
            this.replicateEntry(entry);
        }
    }

    /**
     * Delete from cache
     */
    async delete(key: string): Promise<boolean> {
        const entry = this.cache.get(key);
        if (entry) {
            this.stats.totalSize -= entry.size;
            this.cache.delete(key);
            this.stats.entryCount = this.cache.size;
            return true;
        }
        return false;
    }

    /**
     * Clear cache
     */
    async clear(region?: string): Promise<void> {
        if (region) {
            for (const [key, entry] of this.cache) {
                if (entry.regions.includes(region)) {
                    this.cache.delete(key);
                    this.stats.totalSize -= entry.size;
                }
            }
        } else {
            this.cache.clear();
            this.stats.totalSize = 0;
        }
        this.stats.entryCount = this.cache.size;
    }

    // ======== Region Management ========

    /**
     * Select best region based on latency
     */
    private selectBestRegion(): string {
        // In production, use actual latency measurements
        const regionLatencies = Object.entries(this.stats.regionStats)
            .map(([id, stats]) => ({ id, latency: stats.latency }))
            .sort((a, b) => a.latency - b.latency);

        if (regionLatencies.length > 0) {
            return regionLatencies[0].id;
        }

        // Default to highest priority region
        return this.config.regions.sort((a, b) => a.priority - b.priority)[0].id;
    }

    /**
     * Get region by coordinates (simulated geolocation)
     */
    getRegionByLocation(lat: number, lng: number): EdgeRegion {
        let closest = this.config.regions[0];
        let minDistance = Infinity;

        for (const region of this.config.regions) {
            const distance = Math.sqrt(
                Math.pow(region.location.lat - lat, 2) +
                Math.pow(region.location.lng - lng, 2)
            );
            if (distance < minDistance) {
                minDistance = distance;
                closest = region;
            }
        }

        return closest;
    }

    /**
     * Replicate entry to other regions
     */
    private async replicateEntry(entry: CacheEntry): Promise<void> {
        switch (this.config.replicationStrategy) {
            case "eager":
                // Replicate to all regions immediately
                entry.regions = this.config.regions.map(r => r.id);
                break;

            case "selective":
                // Replicate to nearby regions
                const primaryRegion = this.config.regions.find(r => r.id === entry.regions[0]);
                if (primaryRegion) {
                    const nearby = this.config.regions
                        .filter(r => this.getDistance(r.location, primaryRegion.location) < 5000)
                        .map(r => r.id);
                    entry.regions = [...new Set([...entry.regions, ...nearby])];
                }
                break;

            case "lazy":
            default:
                // Replicate on read (handled in get)
                break;
        }
    }

    // ======== Helpers ========

    private isExpired(entry: CacheEntry): boolean {
        return Date.now() > entry.createdAt + entry.ttl;
    }

    private evictLRU(): void {
        let oldest: CacheEntry | null = null;
        let oldestKey: string | null = null;

        for (const [key, entry] of this.cache) {
            if (!oldest || entry.lastAccessed < oldest.lastAccessed) {
                oldest = entry;
                oldestKey = key;
            }
        }

        if (oldestKey && oldest) {
            this.stats.totalSize -= oldest.size;
            this.cache.delete(oldestKey);
        }
    }

    private recordHit(region: string, latency: number): void {
        this.stats.hits++;
        this.stats.hitRate = this.stats.hits / (this.stats.hits + this.stats.misses);

        if (!this.stats.regionStats[region]) {
            this.stats.regionStats[region] = { hits: 0, latency: 0 };
        }

        const regionStats = this.stats.regionStats[region];
        regionStats.hits++;
        regionStats.latency = (regionStats.latency * (regionStats.hits - 1) + latency) / regionStats.hits;

        this.stats.avgLatency =
            Object.values(this.stats.regionStats).reduce((sum, s) => sum + s.latency, 0) /
            Object.keys(this.stats.regionStats).length;
    }

    private calculateSize(value: any): number {
        return new Blob([JSON.stringify(value)]).size;
    }

    private hash(str: string): string {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return Math.abs(hash).toString(36);
    }

    private getDistance(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
        const R = 6371; // Earth's radius in km
        const dLat = (b.lat - a.lat) * Math.PI / 180;
        const dLng = (b.lng - a.lng) * Math.PI / 180;
        const lat1 = a.lat * Math.PI / 180;
        const lat2 = b.lat * Math.PI / 180;

        const h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.sin(dLng / 2) * Math.sin(dLng / 2) * Math.cos(lat1) * Math.cos(lat2);

        return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
    }

    // ======== Stats ========

    getStats(): CacheStats {
        return { ...this.stats };
    }

    getRegions(): EdgeRegion[] {
        return [...this.config.regions];
    }
}

// ============== Singleton ==============

let edgeCacheInstance: EdgeCachingService | null = null;

export function getEdgeCache(config?: Partial<EdgeConfig>): EdgeCachingService {
    if (!edgeCacheInstance) {
        edgeCacheInstance = new EdgeCachingService(config);
    }
    return edgeCacheInstance;
}

export default EdgeCachingService;
