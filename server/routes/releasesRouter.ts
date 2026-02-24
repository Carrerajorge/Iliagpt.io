import { Router } from "express";
import { db } from "../db";
import { appReleases } from "../../shared/schema";
import { eq } from "drizzle-orm";

export function createPublicReleasesRouter() {
    const router = Router();

    router.get("/", async (req, res) => {
        try {
            const activeReleases = await db
                .select()
                .from(appReleases)
                .where(eq(appReleases.isActive, "true"))
                .orderBy(appReleases.createdAt);

            res.json(activeReleases);
        } catch (err: any) {
            console.error("[Public Releases API] fetch error:", err);
            res.status(500).json({ error: "Failed to fetch active app releases." });
        }
    });

    return router;
}
