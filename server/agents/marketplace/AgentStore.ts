import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import pino from "pino";
import type { AgentManifest, AgentCategory } from "./AgentManifest.js";

const logger = pino({ name: "AgentStore" });

// ─── Types ────────────────────────────────────────────────────────────────────

export type ListingStatus = "pending" | "active" | "deprecated" | "suspended" | "removed";

export interface AgentListing {
  listingId: string;
  manifest: AgentManifest;
  status: ListingStatus;
  publisherId: string;
  /** CDN or file-system URL to the agent bundle */
  bundleUrl: string;
  installCount: number;
  activeInstalls: number;
  averageRating: number;
  reviewCount: number;
  featured: boolean;
  trending: boolean;
  trendingScore: number;
  createdAt: number;
  updatedAt: number;
  /** ISO date the listing was last reviewed by platform staff */
  reviewedAt?: number;
}

export interface AgentReview {
  reviewId: string;
  listingId: string;
  userId: string;
  rating: number; // 1-5
  title: string;
  body: string;
  helpful: number;
  notHelpful: number;
  verified: boolean; // user has actually installed the agent
  createdAt: number;
  updatedAt: number;
  /** set if the review was edited */
  editedAt?: number;
}

export interface CreateListingInput {
  manifest: AgentManifest;
  publisherId: string;
  bundleUrl: string;
}

export interface UpdateListingInput {
  bundleUrl?: string;
  status?: ListingStatus;
  featured?: boolean;
}

export interface CreateReviewInput {
  listingId: string;
  userId: string;
  rating: number;
  title: string;
  body: string;
}

export interface SearchFilters {
  query?: string;
  category?: AgentCategory;
  minRating?: number;
  maxPriceModel?: "free" | "paid";
  featured?: boolean;
  trending?: boolean;
  publisherId?: string;
  tags?: string[];
}

export interface SearchResult {
  listings: AgentListing[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface CategoryInfo {
  id: AgentCategory;
  label: string;
  count: number;
}

// ─── AgentStore ──────────────────────────────────────────────────────────────

export class AgentStore extends EventEmitter {
  private listings = new Map<string, AgentListing>();
  private reviews = new Map<string, AgentReview[]>(); // listingId → reviews
  private userReviews = new Map<string, Set<string>>(); // userId → Set<listingId> they reviewed

  constructor() {
    super();
    logger.info("[AgentStore] Initialized");
  }

  // ── Listings ────────────────────────────────────────────────────────────────

  async createListing(input: CreateListingInput): Promise<AgentListing> {
    const { manifest, publisherId, bundleUrl } = input;

    const existing = this.findByAgentId(manifest.id);
    if (existing && existing.status !== "removed") {
      throw new Error(
        `A listing for agent '${manifest.id}' already exists (status: ${existing.status}). ` +
          `Use updateListing() to publish a new version.`
      );
    }

    const listing: AgentListing = {
      listingId: randomUUID(),
      manifest,
      status: "pending",
      publisherId,
      bundleUrl,
      installCount: 0,
      activeInstalls: 0,
      averageRating: 0,
      reviewCount: 0,
      featured: false,
      trending: false,
      trendingScore: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.listings.set(listing.listingId, listing);
    this.reviews.set(listing.listingId, []);

    this.emit("listing:created", { listingId: listing.listingId, agentId: manifest.id });
    logger.info(
      { listingId: listing.listingId, agentId: manifest.id },
      "[AgentStore] Listing created"
    );

    return listing;
  }

  async getListing(listingId: string): Promise<AgentListing | null> {
    return this.listings.get(listingId) ?? null;
  }

  async getListingByAgentId(agentId: string): Promise<AgentListing | null> {
    return this.findByAgentId(agentId);
  }

  async updateListing(
    listingId: string,
    input: UpdateListingInput
  ): Promise<AgentListing> {
    const listing = this.listings.get(listingId);
    if (!listing) throw new Error(`Listing '${listingId}' not found`);

    const updated: AgentListing = {
      ...listing,
      ...input,
      updatedAt: Date.now(),
    };
    this.listings.set(listingId, updated);

    this.emit("listing:updated", { listingId, changes: input });
    logger.info({ listingId, changes: Object.keys(input) }, "[AgentStore] Listing updated");

    return updated;
  }

  async approveListing(listingId: string): Promise<AgentListing> {
    const listing = await this.getListing(listingId);
    if (!listing) throw new Error(`Listing '${listingId}' not found`);
    if (listing.status !== "pending") {
      throw new Error(
        `Listing '${listingId}' is not pending (status: ${listing.status})`
      );
    }

    const updated = await this.updateListing(listingId, {
      status: "active",
    });
    this.listings.set(listingId, { ...updated, reviewedAt: Date.now() });

    this.emit("listing:approved", { listingId });
    logger.info({ listingId }, "[AgentStore] Listing approved");

    return this.listings.get(listingId)!;
  }

  async suspendListing(listingId: string, reason: string): Promise<AgentListing> {
    const updated = await this.updateListing(listingId, { status: "suspended" });
    this.emit("listing:suspended", { listingId, reason });
    logger.warn({ listingId, reason }, "[AgentStore] Listing suspended");
    return updated;
  }

  async removeListing(listingId: string): Promise<void> {
    const listing = this.listings.get(listingId);
    if (!listing) throw new Error(`Listing '${listingId}' not found`);

    await this.updateListing(listingId, { status: "removed" });
    this.emit("listing:removed", { listingId });
    logger.info({ listingId }, "[AgentStore] Listing removed");
  }

  // ── Install tracking ────────────────────────────────────────────────────────

  async recordInstall(listingId: string): Promise<void> {
    const listing = this.listings.get(listingId);
    if (!listing) throw new Error(`Listing '${listingId}' not found`);

    const updated: AgentListing = {
      ...listing,
      installCount: listing.installCount + 1,
      activeInstalls: listing.activeInstalls + 1,
      trendingScore: this.computeTrendingScore(listing),
      updatedAt: Date.now(),
    };
    this.listings.set(listingId, updated);
    this.emit("agent:installed", { listingId });
  }

  async recordUninstall(listingId: string): Promise<void> {
    const listing = this.listings.get(listingId);
    if (!listing) return;

    const updated: AgentListing = {
      ...listing,
      activeInstalls: Math.max(0, listing.activeInstalls - 1),
      updatedAt: Date.now(),
    };
    this.listings.set(listingId, updated);
    this.emit("agent:uninstalled", { listingId });
  }

  // ── Reviews ─────────────────────────────────────────────────────────────────

  async addReview(input: CreateReviewInput): Promise<AgentReview> {
    const { listingId, userId, rating, title, body } = input;

    if (rating < 1 || rating > 5) {
      throw new Error(`Rating must be between 1 and 5, got ${rating}`);
    }

    const listing = this.listings.get(listingId);
    if (!listing) throw new Error(`Listing '${listingId}' not found`);
    if (listing.status !== "active") {
      throw new Error(`Cannot review a listing with status '${listing.status}'`);
    }

    // One review per user per listing
    const userSet = this.userReviews.get(userId) ?? new Set();
    if (userSet.has(listingId)) {
      throw new Error(
        `User '${userId}' has already reviewed listing '${listingId}'. Use editReview() to update.`
      );
    }

    const review: AgentReview = {
      reviewId: randomUUID(),
      listingId,
      userId,
      rating,
      title: title.slice(0, 128),
      body: body.slice(0, 2048),
      helpful: 0,
      notHelpful: 0,
      verified: listing.installCount > 0, // simplified check
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const listingReviews = this.reviews.get(listingId) ?? [];
    listingReviews.push(review);
    this.reviews.set(listingId, listingReviews);

    userSet.add(listingId);
    this.userReviews.set(userId, userSet);

    // Update aggregate stats
    this.recalculateRating(listingId);

    this.emit("review:added", { reviewId: review.reviewId, listingId, rating });
    logger.info(
      { reviewId: review.reviewId, listingId, rating },
      "[AgentStore] Review added"
    );

    return review;
  }

  async getReviews(
    listingId: string,
    page = 1,
    pageSize = 20
  ): Promise<{ reviews: AgentReview[]; total: number }> {
    const all = this.reviews.get(listingId) ?? [];
    const sorted = [...all].sort((a, b) => b.helpful - a.helpful);
    const start = (page - 1) * pageSize;
    return {
      reviews: sorted.slice(start, start + pageSize),
      total: all.length,
    };
  }

  async voteReview(
    reviewId: string,
    listingId: string,
    vote: "helpful" | "not_helpful"
  ): Promise<AgentReview> {
    const reviews = this.reviews.get(listingId) ?? [];
    const idx = reviews.findIndex((r) => r.reviewId === reviewId);
    if (idx === -1) throw new Error(`Review '${reviewId}' not found`);

    const updated = { ...reviews[idx] };
    if (vote === "helpful") updated.helpful++;
    else updated.notHelpful++;

    reviews[idx] = updated;
    this.reviews.set(listingId, reviews);
    return updated;
  }

  // ── Search ──────────────────────────────────────────────────────────────────

  async search(
    filters: SearchFilters = {},
    page = 1,
    pageSize = 20
  ): Promise<SearchResult> {
    let results = Array.from(this.listings.values()).filter(
      (l) => l.status === "active"
    );

    if (filters.query) {
      const q = filters.query.toLowerCase();
      results = results.filter(
        (l) =>
          l.manifest.name.toLowerCase().includes(q) ||
          l.manifest.description.toLowerCase().includes(q) ||
          l.manifest.tags.some((t) => t.toLowerCase().includes(q))
      );
    }

    if (filters.category) {
      results = results.filter(
        (l) => l.manifest.category === filters.category
      );
    }

    if (filters.minRating !== undefined) {
      results = results.filter((l) => l.averageRating >= filters.minRating!);
    }

    if (filters.maxPriceModel === "free") {
      results = results.filter(
        (l) => l.manifest.pricing.model === "free"
      );
    } else if (filters.maxPriceModel === "paid") {
      results = results.filter(
        (l) => l.manifest.pricing.model !== "free"
      );
    }

    if (filters.featured === true) {
      results = results.filter((l) => l.featured);
    }

    if (filters.trending === true) {
      results = results.filter((l) => l.trending);
    }

    if (filters.publisherId) {
      results = results.filter((l) => l.publisherId === filters.publisherId);
    }

    if (filters.tags?.length) {
      results = results.filter((l) =>
        filters.tags!.every((tag) => l.manifest.tags.includes(tag))
      );
    }

    const total = results.length;
    const start = (page - 1) * pageSize;
    const paginated = results
      .sort((a, b) => b.trendingScore - a.trendingScore)
      .slice(start, start + pageSize);

    return {
      listings: paginated,
      total,
      page,
      pageSize,
      hasMore: start + pageSize < total,
    };
  }

  // ── Featured & trending ─────────────────────────────────────────────────────

  async getFeatured(limit = 6): Promise<AgentListing[]> {
    return Array.from(this.listings.values())
      .filter((l) => l.featured && l.status === "active")
      .sort((a, b) => b.averageRating - a.averageRating)
      .slice(0, limit);
  }

  async getTrending(limit = 10): Promise<AgentListing[]> {
    return Array.from(this.listings.values())
      .filter((l) => l.trending && l.status === "active")
      .sort((a, b) => b.trendingScore - a.trendingScore)
      .slice(0, limit);
  }

  async setFeatured(listingId: string, featured: boolean): Promise<void> {
    await this.updateListing(listingId, { featured });
    logger.info({ listingId, featured }, "[AgentStore] Featured status updated");
  }

  // ── Categories ──────────────────────────────────────────────────────────────

  getCategories(): CategoryInfo[] {
    const counts = new Map<string, number>();
    for (const l of this.listings.values()) {
      if (l.status !== "active") continue;
      const cat = l.manifest.category;
      counts.set(cat, (counts.get(cat) ?? 0) + 1);
    }

    const labels: Record<string, string> = {
      productivity: "Productivity",
      research: "Research",
      coding: "Coding & Dev",
      "data-analysis": "Data Analysis",
      creative: "Creative",
      "customer-support": "Customer Support",
      security: "Security",
      devops: "DevOps",
      finance: "Finance",
      legal: "Legal",
      healthcare: "Healthcare",
      education: "Education",
      other: "Other",
    };

    return Array.from(counts.entries())
      .map(([id, count]) => ({ id: id as AgentCategory, label: labels[id] ?? id, count }))
      .sort((a, b) => b.count - a.count);
  }

  // ── Stats ────────────────────────────────────────────────────────────────────

  getStats() {
    const all = Array.from(this.listings.values());
    const active = all.filter((l) => l.status === "active");
    return {
      total: all.length,
      active: active.length,
      pending: all.filter((l) => l.status === "pending").length,
      totalInstalls: active.reduce((s, l) => s + l.installCount, 0),
      totalActiveInstalls: active.reduce((s, l) => s + l.activeInstalls, 0),
      averageRating:
        active.length > 0
          ? active.reduce((s, l) => s + l.averageRating, 0) / active.length
          : 0,
    };
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private findByAgentId(agentId: string): AgentListing | null {
    for (const listing of this.listings.values()) {
      if (listing.manifest.id === agentId) return listing;
    }
    return null;
  }

  private recalculateRating(listingId: string): void {
    const listing = this.listings.get(listingId);
    if (!listing) return;

    const reviews = this.reviews.get(listingId) ?? [];
    const count = reviews.length;
    const avg = count > 0 ? reviews.reduce((s, r) => s + r.rating, 0) / count : 0;

    this.listings.set(listingId, {
      ...listing,
      averageRating: Math.round(avg * 10) / 10,
      reviewCount: count,
      updatedAt: Date.now(),
    });
  }

  private computeTrendingScore(listing: AgentListing): number {
    // Wilson score-like formula weighted by recency
    const ageMs = Date.now() - listing.createdAt;
    const ageDays = ageMs / 86_400_000;
    const decayFactor = Math.exp(-ageDays / 30); // 30-day half-life

    return (
      listing.installCount * 2 +
      listing.activeInstalls * 3 +
      listing.averageRating * listing.reviewCount * 1.5 +
      (listing.featured ? 10 : 0)
    ) * decayFactor;
  }
}

// ─── Singleton ─────────────────────────────────────────────────────────────────
let _store: AgentStore | null = null;
export function getAgentStore(): AgentStore {
  if (!_store) _store = new AgentStore();
  return _store;
}
