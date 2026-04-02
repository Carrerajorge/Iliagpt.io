import { Router, Request, Response } from "express";
import { db } from "../db";
import { iliaAds, adImpressions } from "../../shared/schema/ads";
import { eq, sql, and, desc } from "drizzle-orm";
import { requireAuth } from "../middleware/auth";
import { insertIliaAdSchema } from "../../shared/schema/ads";
import { z } from "zod";

const router = Router();

router.get("/match", async (req: Request, res: Response) => {
  try {
    const query = (req.query.q as string) || "";
    if (!query) {
      return res.json({ ad: null });
    }

    const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);

    const activeAds = await db
      .select()
      .from(iliaAds)
      .where(eq(iliaAds.active, true))
      .orderBy(desc(iliaAds.createdAt))
      .limit(20);

    let bestAd = null;
    let bestScore = 0;

    for (const ad of activeAds) {
      if (ad.totalBudget && ad.impressions && ad.impressions >= ad.totalBudget) continue;

      let score = 0;
      const adKeywords = (ad.keywords || []).map(k => k.toLowerCase());

      for (const word of queryWords) {
        for (const keyword of adKeywords) {
          if (keyword.includes(word) || word.includes(keyword)) {
            score += 10;
          }
        }
      }

      if (ad.category) {
        const cat = ad.category.toLowerCase();
        if (queryWords.some(w => cat.includes(w) || w.includes(cat))) {
          score += 5;
        }
      }

      if (score === 0 && activeAds.length <= 5) {
        score = 1;
      }

      if (score > bestScore) {
        bestScore = score;
        bestAd = ad;
      }
    }

    if (!bestAd) {
      return res.json({ ad: null });
    }

    res.json({
      ad: {
        id: bestAd.id,
        title: bestAd.title,
        description: bestAd.description,
        imageUrl: bestAd.imageUrl,
        targetUrl: bestAd.targetUrl,
        advertiser: bestAd.advertiser,
      },
    });
  } catch (error: any) {
    console.error("[IliaADS] Match error:", error);
    res.json({ ad: null });
  }
});

router.post("/impression", async (req: Request, res: Response) => {
  try {
    const { adId, query } = req.body;
    if (!adId) return res.status(400).json({ error: "adId required" });

    await db.insert(adImpressions).values({
      adId,
      sessionId: (req as any).sessionID || null,
      query: query || null,
      clicked: false,
    });

    await db
      .update(iliaAds)
      .set({ impressions: sql`${iliaAds.impressions} + 1` })
      .where(eq(iliaAds.id, adId));

    res.json({ ok: true });
  } catch (error: any) {
    console.error("[IliaADS] Impression error:", error);
    res.json({ ok: false });
  }
});

router.post("/click", async (req: Request, res: Response) => {
  try {
    const { adId } = req.body;
    if (!adId) return res.status(400).json({ error: "adId required" });

    await db
      .update(iliaAds)
      .set({ clicks: sql`${iliaAds.clicks} + 1` })
      .where(eq(iliaAds.id, adId));

    res.json({ ok: true });
  } catch (error: any) {
    console.error("[IliaADS] Click error:", error);
    res.json({ ok: false });
  }
});

router.get("/list", requireAuth, async (req: Request, res: Response) => {
  try {
    const ads = await db
      .select()
      .from(iliaAds)
      .orderBy(desc(iliaAds.createdAt))
      .limit(100);

    res.json({ ads });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/create", requireAuth, async (req: Request, res: Response) => {
  try {
    const parsed = insertIliaAdSchema.parse(req.body);
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
    const { active, title, description, imageUrl, targetUrl, keywords, dailyBudget, totalBudget } = req.body;

    const updates: any = {};
    if (active !== undefined) updates.active = active;
    if (title) updates.title = title;
    if (description) updates.description = description;
    if (imageUrl !== undefined) updates.imageUrl = imageUrl;
    if (targetUrl) updates.targetUrl = targetUrl;
    if (keywords) updates.keywords = keywords;
    if (dailyBudget !== undefined) updates.dailyBudget = dailyBudget;
    if (totalBudget !== undefined) updates.totalBudget = totalBudget;

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
    await db.delete(iliaAds).where(eq(iliaAds.id, id));
    res.json({ ok: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/stats", requireAuth, async (req: Request, res: Response) => {
  try {
    const ads = await db
      .select({
        id: iliaAds.id,
        title: iliaAds.title,
        impressions: iliaAds.impressions,
        clicks: iliaAds.clicks,
        active: iliaAds.active,
        dailyBudget: iliaAds.dailyBudget,
        totalBudget: iliaAds.totalBudget,
        costPerImpression: iliaAds.costPerImpression,
      })
      .from(iliaAds)
      .orderBy(desc(iliaAds.impressions))
      .limit(50);

    const totalImpressions = ads.reduce((s, a) => s + (a.impressions || 0), 0);
    const totalClicks = ads.reduce((s, a) => s + (a.clicks || 0), 0);

    res.json({
      ads,
      summary: {
        totalAds: ads.length,
        activeAds: ads.filter(a => a.active).length,
        totalImpressions,
        totalClicks,
        ctr: totalImpressions > 0 ? ((totalClicks / totalImpressions) * 100).toFixed(2) : "0.00",
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
