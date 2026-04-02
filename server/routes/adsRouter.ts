import { Router, Request, Response } from "express";
import { db } from "../db";
import { iliaAds, adImpressions } from "../../shared/schema/ads";
import { eq, sql, desc, and, gte } from "drizzle-orm";
import { requireAuth } from "../middleware/auth";
import { insertIliaAdSchema } from "../../shared/schema/ads";
import { z } from "zod";

const router = Router();

const COST_PER_IMPRESSION_DECI_CENTIMOS = 1;
const SOLES_TO_DECI_CENTIMOS = 1000;

function estimateImpressions(dailyBudgetSoles: number): { min: number; max: number } {
  const budgetDC = dailyBudgetSoles * SOLES_TO_DECI_CENTIMOS;
  const impressionsBase = budgetDC / COST_PER_IMPRESSION_DECI_CENTIMOS;
  return {
    min: Math.round(impressionsBase * 0.55),
    max: Math.round(impressionsBase * 1.05),
  };
}

function calculateRecommendation(category: string): { spend: number; responses: number } {
  const benchmarks: Record<string, { spend: number; responses: number }> = {
    tecnologia: { spend: 18, responses: 6 },
    educacion: { spend: 15, responses: 8 },
    salud: { spend: 22, responses: 5 },
    finanzas: { spend: 25, responses: 4 },
    ecommerce: { spend: 20, responses: 7 },
    general: { spend: 18, responses: 6 },
  };
  return benchmarks[category] || benchmarks.general;
}

function dcToSoles(dc: number): number {
  return dc / SOLES_TO_DECI_CENTIMOS;
}

function solesToDc(soles: number): number {
  return Math.round(soles * SOLES_TO_DECI_CENTIMOS);
}

router.get("/match", async (req: Request, res: Response) => {
  try {
    const query = (req.query.q as string) || "";
    if (!query) return res.json({ ad: null });

    const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    const now = new Date();

    const activeAds = await db
      .select()
      .from(iliaAds)
      .where(
        and(
          eq(iliaAds.active, true),
          eq(iliaAds.status, "active"),
        )
      )
      .orderBy(desc(iliaAds.createdAt))
      .limit(50);

    let bestAd = null;
    let bestScore = 0;
    let bestKeyword = "";

    for (const ad of activeAds) {
      if (ad.endDate && new Date(ad.endDate) < now) continue;

      if (ad.totalBudget && ad.costSpent != null && ad.costSpent >= ad.totalBudget) continue;

      if (ad.dailyBudget) {
        const todayStr = now.toISOString().slice(0, 10);
        const todayImpressions = await db
          .select({ count: sql<number>`count(*)` })
          .from(adImpressions)
          .where(
            and(
              eq(adImpressions.adId, ad.id),
              gte(adImpressions.createdAt, new Date(todayStr))
            )
          );
        const todayCostDC = (todayImpressions[0]?.count || 0) * COST_PER_IMPRESSION_DECI_CENTIMOS;
        if (todayCostDC >= ad.dailyBudget) continue;
      }

      let score = 0;
      let matchedKw = "";
      const adKeywords = (ad.keywords || []).map(k => k.toLowerCase());

      for (const word of queryWords) {
        for (const keyword of adKeywords) {
          if (keyword === word) {
            score += 20;
            matchedKw = keyword;
          } else if (keyword.includes(word) || word.includes(keyword)) {
            score += 10;
            if (!matchedKw) matchedKw = keyword;
          }
        }
      }

      if (ad.category) {
        const cat = ad.category.toLowerCase();
        for (const word of queryWords) {
          if (cat.includes(word) || word.includes(cat)) {
            score += 5;
          }
        }
      }

      if (ad.advantagePlus && score === 0) {
        score = 1;
      }

      if (score > bestScore) {
        bestScore = score;
        bestAd = ad;
        bestKeyword = matchedKw;
      }
    }

    if (!bestAd) return res.json({ ad: null });

    res.json({
      ad: {
        id: bestAd.id,
        title: bestAd.title,
        description: bestAd.description,
        imageUrl: bestAd.imageUrl,
        targetUrl: bestAd.targetUrl,
        advertiser: bestAd.advertiser,
        keyword: bestKeyword,
      },
    });
  } catch (error: any) {
    console.error("[IliaADS] Match error:", error);
    res.json({ ad: null });
  }
});

router.post("/impression", async (req: Request, res: Response) => {
  try {
    const { adId, query, placement } = req.body;
    if (!adId) return res.status(400).json({ error: "adId required" });

    const ad = await db.select({ id: iliaAds.id, active: iliaAds.active, status: iliaAds.status })
      .from(iliaAds).where(eq(iliaAds.id, adId)).limit(1);
    if (!ad.length || !ad[0].active || ad[0].status !== "active") {
      return res.json({ ok: false, reason: "ad_not_active" });
    }

    await db.insert(adImpressions).values({
      adId,
      sessionId: (req as any).sessionID || null,
      query: query || null,
      clicked: false,
      costCharged: COST_PER_IMPRESSION_DECI_CENTIMOS,
      placement: placement || "in_chat",
    });

    await db
      .update(iliaAds)
      .set({
        impressions: sql`${iliaAds.impressions} + 1`,
        costSpent: sql`${iliaAds.costSpent} + ${COST_PER_IMPRESSION_DECI_CENTIMOS}`,
      })
      .where(eq(iliaAds.id, adId));

    res.json({ ok: true, costDC: COST_PER_IMPRESSION_DECI_CENTIMOS });
  } catch (error: any) {
    console.error("[IliaADS] Impression error:", error);
    res.json({ ok: false });
  }
});

router.post("/click", async (req: Request, res: Response) => {
  try {
    const { adId } = req.body;
    if (!adId) return res.status(400).json({ error: "adId required" });

    const ad = await db.select({ id: iliaAds.id, active: iliaAds.active })
      .from(iliaAds).where(eq(iliaAds.id, adId)).limit(1);
    if (!ad.length || !ad[0].active) {
      return res.json({ ok: false, reason: "ad_not_active" });
    }

    await db
      .update(iliaAds)
      .set({
        clicks: sql`${iliaAds.clicks} + 1`,
        messagesReceived: sql`${iliaAds.messagesReceived} + 1`,
      })
      .where(eq(iliaAds.id, adId));

    res.json({ ok: true });
  } catch (error: any) {
    console.error("[IliaADS] Click error:", error);
    res.json({ ok: false });
  }
});

router.get("/estimate", async (req: Request, res: Response) => {
  try {
    const budgetSoles = parseFloat(req.query.budget as string) || 3.5;
    const category = (req.query.category as string) || "general";
    const durationDays = parseInt(req.query.days as string) || 7;

    const daily = estimateImpressions(budgetSoles);
    const recommendation = calculateRecommendation(category);

    res.json({
      daily: { min: daily.min, max: daily.max },
      total: {
        min: daily.min * durationDays,
        max: daily.max * durationDays,
      },
      costPerImpression: 0.1,
      costPerImpressionLabel: "0.1 centimos",
      recommendation: {
        avgSpend: recommendation.spend,
        avgResponses: recommendation.responses,
        label: `Otros negocios similares suelen gastar S/${recommendation.spend.toFixed(2)} y consiguen ${recommendation.responses} respuestas por dia.`,
      },
      currency: "PEN",
      symbol: "S/",
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/list", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id || (req as any).sessionID;
    const ads = await db
      .select()
      .from(iliaAds)
      .where(eq(iliaAds.createdBy, userId))
      .orderBy(desc(iliaAds.createdAt))
      .limit(100);

    res.json({ ads });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/create", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id || (req as any).sessionID;
    const dailyBudgetSoles = parseFloat(req.body.dailyBudget) || 3.5;
    const durationDays = parseInt(req.body.durationDays) || 7;

    const dailyBudgetDC = solesToDc(dailyBudgetSoles);
    const totalBudgetDC = dailyBudgetDC * durationDays;

    const start = req.body.startDate ? new Date(req.body.startDate) : new Date();
    const end = new Date(start);
    end.setDate(end.getDate() + durationDays);

    const body = {
      ...req.body,
      dailyBudget: dailyBudgetDC,
      totalBudget: totalBudgetDC,
      costPerImpression: COST_PER_IMPRESSION_DECI_CENTIMOS,
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      durationDays,
      status: "active",
      active: true,
      createdBy: userId,
    };

    if (typeof body.keywords === "string") {
      body.keywords = body.keywords.split(",").map((k: string) => k.trim()).filter(Boolean);
    }

    body.imageUrl = body.imageUrl || null;

    if (body.minAge && body.maxAge && body.minAge > body.maxAge) {
      return res.status(400).json({ error: "minAge must be <= maxAge" });
    }

    const parsed = insertIliaAdSchema.parse(body);
    const [ad] = await db.insert(iliaAds).values(parsed).returning();
    res.json({ ad });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    res.status(500).json({ error: error.message });
  }
});

router.patch("/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const userId = (req as any).user?.id || (req as any).sessionID;

    const existing = await db.select({ createdBy: iliaAds.createdBy })
      .from(iliaAds).where(eq(iliaAds.id, id)).limit(1);
    if (!existing.length || existing[0].createdBy !== userId) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const allowedFields = [
      "active", "title", "description", "imageUrl", "targetUrl",
      "keywords", "dailyBudget", "totalBudget", "status",
      "objective", "durationDays", "startDate", "endDate",
      "placements", "paymentMethod", "targetCountry",
      "minAge", "maxAge", "gender", "advantagePlus", "category",
    ];

    const updates: any = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }

    const [ad] = await db
      .update(iliaAds)
      .set(updates)
      .where(eq(iliaAds.id, id))
      .returning();

    res.json({ ad });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.delete("/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const userId = (req as any).user?.id || (req as any).sessionID;

    const existing = await db.select({ createdBy: iliaAds.createdBy })
      .from(iliaAds).where(eq(iliaAds.id, id)).limit(1);
    if (!existing.length || existing[0].createdBy !== userId) {
      return res.status(403).json({ error: "Forbidden" });
    }

    await db.delete(iliaAds).where(eq(iliaAds.id, id));
    res.json({ ok: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/stats", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id || (req as any).sessionID;
    const ads = await db
      .select()
      .from(iliaAds)
      .where(eq(iliaAds.createdBy, userId))
      .orderBy(desc(iliaAds.impressions))
      .limit(100);

    const totalImpressions = ads.reduce((s, a) => s + (a.impressions || 0), 0);
    const totalClicks = ads.reduce((s, a) => s + (a.clicks || 0), 0);
    const totalSpentDC = ads.reduce((s, a) => s + (a.costSpent || 0), 0);
    const totalMessages = ads.reduce((s, a) => s + (a.messagesReceived || 0), 0);

    res.json({
      ads: ads.map(a => ({
        ...a,
        dailyBudgetSoles: dcToSoles(a.dailyBudget || 0).toFixed(2),
        totalBudgetSoles: dcToSoles(a.totalBudget || 0).toFixed(2),
        costSpentSoles: dcToSoles(a.costSpent || 0).toFixed(2),
        estimatedDaily: estimateImpressions(dcToSoles(a.dailyBudget || 0)),
      })),
      summary: {
        totalAds: ads.length,
        activeAds: ads.filter(a => a.active).length,
        totalImpressions,
        totalClicks,
        totalMessages,
        totalSpentSoles: dcToSoles(totalSpentDC).toFixed(2),
        ctr: totalImpressions > 0 ? ((totalClicks / totalImpressions) * 100).toFixed(2) : "0.00",
        avgCostPerClick: totalClicks > 0 ? dcToSoles(totalSpentDC / totalClicks).toFixed(2) : "0.00",
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
