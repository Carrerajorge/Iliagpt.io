import { Router } from "express";
import { storage } from "../storage";
import { libraryService, LibraryServiceError, type FileMetadata } from "../services/libraryService";
import { getOrCreateSecureUserId } from "../lib/anonUserHelper";
import { db } from "../db";
import { eq, and, desc, isNull } from "drizzle-orm";
import { generateWordDocument, generateExcelDocument, generatePptDocument, parseExcelFromText, parseSlidesFromText } from "../services/documentGeneration";
import { DocumentCompiler, type CompilerFormat } from "../agent/documents/compiler";
import fs from "fs";
import path from "path";
import {
  libraryFiles,
  libraryFolders,
  libraryCollections,
  libraryFileCollections,
  type InsertLibraryFolder,
  type InsertLibraryCollection,
} from "@shared/schema";
import { randomUUID } from "crypto";
import { validate } from "../middleware/validateRequest";
import {
  uploadRequestUrlSchema,
  uploadCompleteSchema,
  createFolderSchema,
  updateFolderSchema,
  createCollectionSchema,
  updateCollectionSchema,
  addFileToCollectionSchema,
  updateFileSchema,
  libraryFilesQuerySchema,
  uuidParamSchema,
  fileIdParamSchema,
  createLibraryItemSchema,
} from "../schemas/librarySchemas";

export function createLibraryRouter() {
  const router = Router();

  router.post("/api/library/upload/request-url", ...validate({ body: uploadRequestUrlSchema }), async (req, res) => {
    try {
      const userId = getOrCreateSecureUserId(req);

      const { filename, contentType, folderId } = req.body;

      const result = await libraryService.generateUploadUrl(
        userId,
        filename,
        contentType || "application/octet-stream",
        folderId
      );

      res.json(result);
    } catch (error: any) {
      if (error instanceof LibraryServiceError) {
        return res.status(error.statusCode).json({ error: error.message, code: error.code });
      }
      console.error("Error requesting upload URL:", error);
      res.status(500).json({ error: "Failed to generate upload URL" });
    }
  });

  router.post("/api/library/upload/complete", ...validate({ body: uploadCompleteSchema }), async (req, res) => {
    try {
      const userId = getOrCreateSecureUserId(req);

      const { storagePath, metadata } = req.body;

      const fileMetadata: FileMetadata = {
        name: metadata.name,
        originalName: metadata.originalName,
        description: metadata.description,
        type: metadata.type || "other",
        mimeType: metadata.mimeType || "application/octet-stream",
        extension: metadata.extension || "",
        size: metadata.size || 0,
        width: metadata.width,
        height: metadata.height,
        duration: metadata.duration,
        pages: metadata.pages,
        tags: metadata.tags,
        metadata: metadata.metadata,
      };

      const file = await libraryService.saveFileMetadata(userId, storagePath, fileMetadata);
      res.json(file);
    } catch (error: any) {
      if (error instanceof LibraryServiceError) {
        return res.status(error.statusCode).json({ error: error.message, code: error.code });
      }
      console.error("Error completing upload:", error);
      res.status(500).json({ error: "Failed to save file metadata" });
    }
  });

  router.get("/api/library/folders", async (req, res) => {
    try {
      const userId = getOrCreateSecureUserId(req);

      const folders = await db
        .select()
        .from(libraryFolders)
        .where(eq(libraryFolders.userId, userId))
        .orderBy(desc(libraryFolders.createdAt));

      res.json(folders);
    } catch (error: any) {
      console.error("Error getting folders:", error);
      res.status(500).json({ error: "Failed to get folders" });
    }
  });

  router.post("/api/library/folders", ...validate({ body: createFolderSchema }), async (req, res) => {
    try {
      const userId = getOrCreateSecureUserId(req);

      const { name, description, color, icon, parentId } = req.body;

      let parentPath = "/";
      if (parentId) {
        const [parent] = await db
          .select()
          .from(libraryFolders)
          .where(and(eq(libraryFolders.id, parentId), eq(libraryFolders.userId, userId)))
          .limit(1);

        if (!parent) {
          return res.status(404).json({ error: "Parent folder not found" });
        }
        parentPath = parent.path;
      }

      const folderData: InsertLibraryFolder = {
        uuid: randomUUID(),
        name,
        description: description || null,
        color: color || "#6366f1",
        icon: icon || "folder",
        parentId: parentId || null,
        path: `${parentPath}${name}/`,
        userId,
        isSystem: false,
      };

      const [folder] = await db.insert(libraryFolders).values(folderData).returning();
      res.json(folder);
    } catch (error: any) {
      console.error("Error creating folder:", error);
      res.status(500).json({ error: "Failed to create folder" });
    }
  });

  router.put("/api/library/folders/:id", ...validate({ body: updateFolderSchema, params: uuidParamSchema }), async (req, res) => {
    try {
      const userId = getOrCreateSecureUserId(req);

      const { id } = req.params;
      const { name, description, color, icon } = req.body;

      const [existing] = await db
        .select()
        .from(libraryFolders)
        .where(and(eq(libraryFolders.uuid, id), eq(libraryFolders.userId, userId)))
        .limit(1);

      if (!existing) {
        return res.status(404).json({ error: "Folder not found" });
      }

      const updates: Partial<InsertLibraryFolder> = {
        updatedAt: new Date(),
      };

      if (name !== undefined) updates.name = name;
      if (description !== undefined) updates.description = description;
      if (color !== undefined) updates.color = color;
      if (icon !== undefined) updates.icon = icon;

      const [updated] = await db
        .update(libraryFolders)
        .set(updates)
        .where(eq(libraryFolders.id, existing.id))
        .returning();

      res.json(updated);
    } catch (error: any) {
      console.error("Error updating folder:", error);
      res.status(500).json({ error: "Failed to update folder" });
    }
  });

  router.delete("/api/library/folders/:id", async (req, res) => {
    try {
      const userId = getOrCreateSecureUserId(req);

      const { id } = req.params;

      const [folder] = await db
        .select()
        .from(libraryFolders)
        .where(and(eq(libraryFolders.uuid, id), eq(libraryFolders.userId, userId)))
        .limit(1);

      if (!folder) {
        return res.status(404).json({ error: "Folder not found" });
      }

      await db.update(libraryFiles)
        .set({ folderId: null })
        .where(eq(libraryFiles.folderId, folder.id));

      await db.delete(libraryFolders).where(eq(libraryFolders.id, folder.id));

      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting folder:", error);
      res.status(500).json({ error: "Failed to delete folder" });
    }
  });

  router.get("/api/library/collections", async (req, res) => {
    try {
      const userId = getOrCreateSecureUserId(req);

      const collections = await db
        .select()
        .from(libraryCollections)
        .where(eq(libraryCollections.userId, userId))
        .orderBy(desc(libraryCollections.createdAt));

      res.json(collections);
    } catch (error: any) {
      console.error("Error getting collections:", error);
      res.status(500).json({ error: "Failed to get collections" });
    }
  });

  router.post("/api/library/collections", ...validate({ body: createCollectionSchema }), async (req, res) => {
    try {
      const userId = getOrCreateSecureUserId(req);

      const { name, description, type, coverFileId, smartRules, isPublic } = req.body;

      const collectionData: InsertLibraryCollection = {
        uuid: randomUUID(),
        name,
        description: description || null,
        coverFileId: coverFileId || null,
        type: type || "album",
        smartRules: smartRules || null,
        userId,
        isPublic: isPublic || false,
      };

      const [collection] = await db.insert(libraryCollections).values(collectionData).returning();
      res.json(collection);
    } catch (error: any) {
      console.error("Error creating collection:", error);
      res.status(500).json({ error: "Failed to create collection" });
    }
  });

  router.put("/api/library/collections/:id", ...validate({ body: updateCollectionSchema, params: uuidParamSchema }), async (req, res) => {
    try {
      const userId = getOrCreateSecureUserId(req);

      const { id } = req.params;
      const { name, description, type, coverFileId, smartRules, isPublic } = req.body;

      const [existing] = await db
        .select()
        .from(libraryCollections)
        .where(and(eq(libraryCollections.uuid, id), eq(libraryCollections.userId, userId)))
        .limit(1);

      if (!existing) {
        return res.status(404).json({ error: "Collection not found" });
      }

      const updates: Partial<InsertLibraryCollection> = {
        updatedAt: new Date(),
      };

      if (name !== undefined) updates.name = name;
      if (description !== undefined) updates.description = description;
      if (type !== undefined) updates.type = type;
      if (coverFileId !== undefined) updates.coverFileId = coverFileId;
      if (smartRules !== undefined) updates.smartRules = smartRules;
      if (isPublic !== undefined) updates.isPublic = isPublic;

      const [updated] = await db
        .update(libraryCollections)
        .set(updates)
        .where(eq(libraryCollections.id, existing.id))
        .returning();

      res.json(updated);
    } catch (error: any) {
      console.error("Error updating collection:", error);
      res.status(500).json({ error: "Failed to update collection" });
    }
  });

  router.delete("/api/library/collections/:id", async (req, res) => {
    try {
      const userId = getOrCreateSecureUserId(req);

      const { id } = req.params;

      const [collection] = await db
        .select()
        .from(libraryCollections)
        .where(and(eq(libraryCollections.uuid, id), eq(libraryCollections.userId, userId)))
        .limit(1);

      if (!collection) {
        return res.status(404).json({ error: "Collection not found" });
      }

      await db.delete(libraryFileCollections).where(eq(libraryFileCollections.collectionId, collection.id));

      await db.delete(libraryCollections).where(eq(libraryCollections.id, collection.id));

      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting collection:", error);
      res.status(500).json({ error: "Failed to delete collection" });
    }
  });

  router.post("/api/library/collections/:id/files", ...validate({ body: addFileToCollectionSchema, params: uuidParamSchema }), async (req, res) => {
    try {
      const userId = getOrCreateSecureUserId(req);

      const { id } = req.params;
      const { fileId, order } = req.body;

      const [collection] = await db
        .select()
        .from(libraryCollections)
        .where(and(eq(libraryCollections.uuid, id), eq(libraryCollections.userId, userId)))
        .limit(1);

      if (!collection) {
        return res.status(404).json({ error: "Collection not found" });
      }

      const [file] = await db
        .select()
        .from(libraryFiles)
        .where(and(eq(libraryFiles.uuid, fileId), eq(libraryFiles.userId, userId)))
        .limit(1);

      if (!file) {
        return res.status(404).json({ error: "File not found" });
      }

      const [existing] = await db
        .select()
        .from(libraryFileCollections)
        .where(
          and(
            eq(libraryFileCollections.fileId, file.id),
            eq(libraryFileCollections.collectionId, collection.id)
          )
        )
        .limit(1);

      if (existing) {
        return res.status(409).json({ error: "File already in collection" });
      }

      const [fileCollection] = await db
        .insert(libraryFileCollections)
        .values({
          fileId: file.id,
          collectionId: collection.id,
          order: order || 0,
        })
        .returning();

      res.json(fileCollection);
    } catch (error: any) {
      console.error("Error adding file to collection:", error);
      res.status(500).json({ error: "Failed to add file to collection" });
    }
  });

  router.delete("/api/library/collections/:id/files/:fileId", async (req, res) => {
    try {
      const userId = getOrCreateSecureUserId(req);

      const { id, fileId } = req.params;

      const [collection] = await db
        .select()
        .from(libraryCollections)
        .where(and(eq(libraryCollections.uuid, id), eq(libraryCollections.userId, userId)))
        .limit(1);

      if (!collection) {
        return res.status(404).json({ error: "Collection not found" });
      }

      const [file] = await db
        .select()
        .from(libraryFiles)
        .where(and(eq(libraryFiles.uuid, fileId), eq(libraryFiles.userId, userId)))
        .limit(1);

      if (!file) {
        return res.status(404).json({ error: "File not found" });
      }

      await db
        .delete(libraryFileCollections)
        .where(
          and(
            eq(libraryFileCollections.fileId, file.id),
            eq(libraryFileCollections.collectionId, collection.id)
          )
        );

      res.json({ success: true });
    } catch (error: any) {
      console.error("Error removing file from collection:", error);
      res.status(500).json({ error: "Failed to remove file from collection" });
    }
  });

  router.get("/api/library/files", ...validate({ query: libraryFilesQuerySchema }), async (req, res) => {
    try {
      const userId = getOrCreateSecureUserId(req);

      const { type, folder, search, limit, offset } = req.query;

      let query = db
        .select()
        .from(libraryFiles)
        .where(
          and(
            eq(libraryFiles.userId, userId),
            isNull(libraryFiles.deletedAt)
          )
        )
        .orderBy(desc(libraryFiles.createdAt));

      const files = await query;

      let filtered = files;

      if (type) {
        filtered = filtered.filter((f) => f.type === type);
      }

      if (folder) {
        const folderId = parseInt(folder as string, 10);
        if (!isNaN(folderId)) {
          filtered = filtered.filter((f) => f.folderId === folderId);
        }
      }

      if (search) {
        const searchTerm = (search as string).toLowerCase();
        filtered = filtered.filter(
          (f) =>
            f.name.toLowerCase().includes(searchTerm) ||
            f.originalName.toLowerCase().includes(searchTerm) ||
            (f.description && f.description.toLowerCase().includes(searchTerm)) ||
            (f.tags && f.tags.some((tag) => tag.toLowerCase().includes(searchTerm)))
        );
      }

      if (offset) {
        const offsetNum = parseInt(offset as string, 10);
        if (!isNaN(offsetNum)) {
          filtered = filtered.slice(offsetNum);
        }
      }

      if (limit) {
        const limitNum = parseInt(limit as string, 10);
        if (!isNaN(limitNum)) {
          filtered = filtered.slice(0, limitNum);
        }
      }

      res.json(filtered);
    } catch (error: any) {
      console.error("Error getting files:", error);
      res.status(500).json({ error: "Failed to get files" });
    }
  });

  router.get("/api/library/files/:id", async (req, res) => {
    try {
      const userId = getOrCreateSecureUserId(req);

      const { id } = req.params;

      const file = await libraryService.getFile(userId, id);

      if (!file) {
        return res.status(404).json({ error: "File not found" });
      }

      res.json(file);
    } catch (error: any) {
      console.error("Error getting file:", error);
      res.status(500).json({ error: "Failed to get file" });
    }
  });

  router.put("/api/library/files/:id", ...validate({ body: updateFileSchema, params: uuidParamSchema }), async (req, res) => {
    try {
      const userId = getOrCreateSecureUserId(req);

      const { id } = req.params;
      const { name, description, tags, folderId, isFavorite, isPinned, isArchived, isPublic, metadata } = req.body;

      const [existing] = await db
        .select()
        .from(libraryFiles)
        .where(and(eq(libraryFiles.uuid, id), eq(libraryFiles.userId, userId)))
        .limit(1);

      if (!existing) {
        return res.status(404).json({ error: "File not found" });
      }

      const updates: Record<string, any> = {
        updatedAt: new Date(),
      };

      if (name !== undefined) updates.name = name;
      if (description !== undefined) updates.description = description;
      if (tags !== undefined) updates.tags = tags;
      if (folderId !== undefined) updates.folderId = folderId;
      if (isFavorite !== undefined) updates.isFavorite = isFavorite;
      if (isPinned !== undefined) updates.isPinned = isPinned;
      if (isArchived !== undefined) updates.isArchived = isArchived;
      if (isPublic !== undefined) updates.isPublic = isPublic;
      if (metadata !== undefined) updates.metadata = metadata;

      const [updated] = await db
        .update(libraryFiles)
        .set(updates)
        .where(eq(libraryFiles.id, existing.id))
        .returning();

      res.json(updated);
    } catch (error: any) {
      console.error("Error updating file:", error);
      res.status(500).json({ error: "Failed to update file" });
    }
  });

  router.delete("/api/library/files/:id", async (req, res) => {
    try {
      const userId = getOrCreateSecureUserId(req);

      const { id } = req.params;

      const deleted = await libraryService.deleteFile(userId, id);

      if (!deleted) {
        return res.status(404).json({ error: "File not found" });
      }

      res.json({ success: true });
    } catch (error: any) {
      if (error instanceof LibraryServiceError) {
        return res.status(error.statusCode).json({ error: error.message, code: error.code });
      }
      console.error("Error deleting file:", error);
      res.status(500).json({ error: "Failed to delete file" });
    }
  });

  router.get("/api/library/files/:id/download", async (req, res) => {
    try {
      const userId = getOrCreateSecureUserId(req);

      const { id } = req.params;

      const downloadUrl = await libraryService.getFileUrl(userId, id);

      res.json({ downloadUrl });
    } catch (error: any) {
      if (error instanceof LibraryServiceError) {
        return res.status(error.statusCode).json({ error: error.message, code: error.code });
      }
      console.error("Error getting download URL:", error);
      res.status(500).json({ error: "Failed to get download URL" });
    }
  });

  router.get("/api/library/stats", async (req, res) => {
    try {
      const userId = getOrCreateSecureUserId(req);

      const stats = await libraryService.getStorageStats(userId);

      if (!stats) {
        return res.status(404).json({ error: "Stats not found" });
      }

      res.json(stats);
    } catch (error: any) {
      if (error instanceof LibraryServiceError) {
        return res.status(error.statusCode).json({ error: error.message, code: error.code });
      }
      console.error("Error getting stats:", error);
      res.status(500).json({ error: "Failed to get storage statistics" });
    }
  });

  router.get("/api/library", async (req, res) => {
    try {
      const user = (req as any).user;
      const userId = user?.claims?.sub;

      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const mediaType = req.query.type as string | undefined;
      const items = await storage.getLibraryItems(userId, mediaType);
      res.json(items);
    } catch (error: any) {
      console.error("Error getting library items:", error);
      res.status(500).json({ error: "Failed to get library items" });
    }
  });

  router.post("/api/library", ...validate({ body: createLibraryItemSchema }), async (req, res) => {
    try {
      const user = (req as any).user;
      const userId = user?.claims?.sub;

      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const { mediaType, title, description, storagePath, thumbnailPath, mimeType, size, metadata, sourceChatId } = req.body;

      const item = await storage.createLibraryItem({
        userId,
        mediaType,
        title,
        description: description || null,
        storagePath,
        thumbnailPath: thumbnailPath || null,
        mimeType: mimeType || null,
        size: size || null,
        metadata: metadata || null,
        sourceChatId: sourceChatId || null,
      });

      res.json(item);
    } catch (error: any) {
      console.error("Error creating library item:", error);
      res.status(500).json({ error: "Failed to create library item" });
    }
  });

  router.delete("/api/library/:id", async (req, res) => {
    try {
      const user = (req as any).user;
      const userId = user?.claims?.sub;

      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const deleted = await storage.deleteLibraryItem(req.params.id, userId);

      if (!deleted) {
        return res.status(404).json({ error: "Library item not found" });
      }

      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting library item:", error);
      res.status(500).json({ error: "Failed to delete library item" });
    }
  });

  // ============================================
  // SAVE FROM EDITOR — Save AI-generated document to library
  // ============================================
  router.post("/api/library/save-from-editor", async (req, res) => {
    try {
      const userId = getOrCreateSecureUserId(req);
      const { title, content, type } = req.body ?? {};

      // Strict type validation (replaces loose truthy checks)
      if (typeof title !== "string" || typeof content !== "string" || typeof type !== "string") {
        return res.status(400).json({ error: "title, content, and type must be non-empty strings" });
      }

      const ALLOWED_TYPES = ["word", "excel", "ppt"] as const;
      if (!(ALLOWED_TYPES as readonly string[]).includes(type)) {
        return res.status(400).json({ error: "type must be 'word', 'excel', or 'ppt'" });
      }

      // Content size validation (prevent huge payloads from consuming memory)
      const MAX_TITLE_LENGTH = 500;
      const MAX_CONTENT_SIZE = 5 * 1024 * 1024; // 5MB (Express body limit is 1MB, but be safe)
      if (title.length === 0 || title.length > MAX_TITLE_LENGTH) {
        return res.status(400).json({ error: `Title must be 1-${MAX_TITLE_LENGTH} characters` });
      }
      if (content.length === 0 || content.length > MAX_CONTENT_SIZE) {
        return res.status(400).json({ error: "Content must be non-empty and under 5MB" });
      }

      // Generate binary document via DocumentCompiler (unified pipeline)
      const formatMap: Record<string, CompilerFormat> = { word: "docx", excel: "xlsx", ppt: "pptx" };
      const compilerFormat = formatMap[type];
      if (!compilerFormat) {
        return res.status(400).json({ error: "Unsupported document type" });
      }

      const compiler = new DocumentCompiler("corporate");
      let buffer: Buffer;
      let ext: string;
      let mimeType: string;

      try {
        const result = await compiler.compileFromText({
          format: compilerFormat,
          title,
          content,
          theme: "corporate",
        });
        buffer = result.buffer;
        ext = compilerFormat === "pptx" ? "pptx" : compilerFormat === "docx" ? "docx" : "xlsx";
        mimeType = result.mimeType;

        if (result.metrics.degraded) {
          console.warn(`[Library] Document compiled in degraded mode: ${result.validation.issues.map(i => i.message).join(", ")}`);
        }
      } catch (compilerErr) {
        // Fallback to legacy generation if compiler fails entirely
        console.warn(`[Library] Compiler failed, using legacy generation: ${compilerErr instanceof Error ? compilerErr.message : String(compilerErr)}`);
        switch (type) {
          case "word":
            buffer = await generateWordDocument(title, content);
            ext = "docx";
            mimeType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
            break;
          case "excel": {
            const excelData = parseExcelFromText(content);
            buffer = await generateExcelDocument(title, excelData);
            ext = "xlsx";
            mimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
            break;
          }
          case "ppt": {
            const slides = parseSlidesFromText(content);
            buffer = await generatePptDocument(title, slides);
            ext = "pptx";
            mimeType = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
            break;
          }
          default:
            return res.status(400).json({ error: "Unsupported document type" });
        }
      }

      // Save to local uploads directory (with cleanup on failure)
      const fileUuid = randomUUID();
      // Sanitize filename: strip unsafe chars, cap at 80 chars to prevent filesystem issues
      const safeTitle = title.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_').substring(0, 80);
      const filename = `${safeTitle || 'document'}_${fileUuid.slice(0, 8)}.${ext}`;
      const uploadsDir = path.join(process.cwd(), "uploads");
      await fs.promises.mkdir(uploadsDir, { recursive: true });
      const filePath = path.join(uploadsDir, fileUuid);
      const tmpPath = filePath + ".tmp";

      try {
        // Atomic write: write to tmp first, then rename
        await fs.promises.writeFile(tmpPath, buffer, { mode: 0o640 });
        await fs.promises.rename(tmpPath, filePath);
      } catch (writeErr: any) {
        await fs.promises.unlink(tmpPath).catch(() => { }); // cleanup tmp on error
        if (writeErr?.code === "ENOSPC") {
          return res.status(507).json({ error: "Insufficient disk space to save document" });
        }
        throw writeErr;
      }

      let file: any;
      try {
        // Save metadata to library database
        const storagePath = `/objects/uploads/${fileUuid}`;
        file = await libraryService.saveFileMetadata(userId, storagePath, {
          name: `${title}.${ext}`,
          originalName: filename,
          type: "document",
          mimeType,
          extension: ext,
          size: buffer.length,
          tags: ["ai-generated"],
        });
      } catch (dbErr) {
        // Clean up written file if DB save fails
        try {
          await fs.promises.unlink(filePath);
        } catch (cleanupErr) {
          console.warn(`[Library] Failed to cleanup orphaned file ${fileUuid}: ${cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr)}`);
        }
        throw dbErr;
      }

      console.log(`[Library] Saved document to library: ${filename} (${buffer.length} bytes) -> ${file.id}`);

      res.json({
        success: true,
        file: {
          id: file.id,
          uuid: file.uuid,
          name: file.name,
          size: buffer.length,
          type: ext,
        },
      });
    } catch (error: any) {
      console.error("Error saving document to library:", error instanceof Error ? error.message : String(error));
      if (error?.code === "ENOSPC") {
        return res.status(507).json({ error: "Insufficient disk space" });
      }
      // Don't leak internal error details to client
      res.status(500).json({ error: "Failed to save document to library" });
    }
  });

  router.get("/api/library/export", async (req, res) => {
    try {
      const userId = getOrCreateSecureUserId(req);
      const metadata = await libraryService.exportLibraryMetadata(userId);

      // Set headers for file download
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="library_export_${new Date().toISOString().split('T')[0]}.json"`);

      res.json(metadata);
    } catch (error: any) {
      if (error instanceof LibraryServiceError) {
        return res.status(error.statusCode).json({ error: error.message, code: error.code });
      }
      console.error("Error exporting library:", error);
      res.status(500).json({ error: "Failed to export library" });
    }
  });

  return router;
}
