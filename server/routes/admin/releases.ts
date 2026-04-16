import { Router } from "express";
import { db } from "../../db";
import { appReleases, insertAppReleaseSchema } from "../../../shared/schema";
import { eq } from "drizzle-orm";

export const releasesAdminRouter = Router();

// Get all releases (including inactive)
releasesAdminRouter.get("/", async (req, res) => {
    try {
        const releases = await db.select().from(appReleases).orderBy(appReleases.createdAt);
        res.json(releases);
    } catch (err: any) {
        console.error("[Admin Releases API] Fetch error:", err);
        res.status(500).json({ error: "Failed to fetch releases." });
    }
});

// Create a new release
releasesAdminRouter.post("/", async (req, res) => {
    try {
        const data = insertAppReleaseSchema.parse(req.body);
        const [inserted] = await db.insert(appReleases).values(data).returning();
        res.status(201).json(inserted);
    } catch (err: any) {
        console.error("[Admin Releases API] Create error:", err);
        res.status(400).json({ error: err.message || "Invalid release data." });
    }
});

// Update an existing release
releasesAdminRouter.patch("/:id", async (req, res) => {
    try {
        const { id } = req.params;
        // Partial schema parse
        const data = insertAppReleaseSchema.partial().parse(req.body);
        const [updated] = await db
            .update(appReleases)
            .set({ ...data, updatedAt: new Date() })
            .where(eq(appReleases.id, id))
            .returning();

        if (!updated) {
            return res.status(404).json({ error: "Release not found." });
        }
        res.json(updated);
    } catch (err: any) {
        console.error("[Admin Releases API] Update error:", err);
        res.status(400).json({ error: err.message || "Invalid update data." });
    }
});

// Delete a release
releasesAdminRouter.delete("/:id", async (req, res) => {
    try {
        const { id } = req.params;
        const [deleted] = await db.delete(appReleases).where(eq(appReleases.id, id)).returning();
        if (!deleted) {
            return res.status(404).json({ error: "Release not found." });
        }
        res.json({ success: true, deletedId: id });
    } catch (err: any) {
        console.error("[Admin Releases API] Delete error:", err);
        res.status(500).json({ error: "Failed to delete release." });
    }
});
