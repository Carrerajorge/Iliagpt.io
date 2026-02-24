import { randomUUID } from "crypto";
import { db } from "../db";
import { eq, sql, and, isNull, desc } from "drizzle-orm";
import {
  libraryFiles,
  libraryFolders,
  libraryActivity,
  libraryStorage,
  type InsertLibraryFile,
  type LibraryFile,
  type LibraryStorageStats,
} from "@shared/schema";
import {
  ObjectStorageService,
  ObjectNotFoundError,
  objectStorageClient,
} from "../replit_integrations/object_storage";

export interface FileMetadata {
  name: string;
  originalName: string;
  description?: string;
  type: string;
  mimeType: string;
  extension: string;
  size: number;
  width?: number;
  height?: number;
  duration?: number;
  pages?: number;
  tags?: string[];
  metadata?: Record<string, any>;
}

export interface UploadUrlResponse {
  uploadUrl: string;
  objectPath: string;
  fileUuid: string;
}

export class LibraryServiceError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 500
  ) {
    super(message);
    this.name = "LibraryServiceError";
  }
}

export class LibraryService {
  private objectStorage: ObjectStorageService;

  constructor() {
    this.objectStorage = new ObjectStorageService();
  }

  async generateUploadUrl(
    userId: string,
    filename: string,
    contentType: string,
    folderId?: string
  ): Promise<UploadUrlResponse> {
    if (!userId) {
      throw new LibraryServiceError(
        "User ID is required",
        "INVALID_USER_ID",
        400
      );
    }

    if (!filename) {
      throw new LibraryServiceError(
        "Filename is required",
        "INVALID_FILENAME",
        400
      );
    }

    try {
      if (folderId) {
        const folder = await db
          .select()
          .from(libraryFolders)
          .where(
            and(
              eq(libraryFolders.uuid, folderId),
              eq(libraryFolders.userId, userId)
            )
          )
          .limit(1);

        if (folder.length === 0) {
          throw new LibraryServiceError(
            "Folder not found or access denied",
            "FOLDER_NOT_FOUND",
            404
          );
        }
      }

      const uploadUrl = await this.objectStorage.getObjectEntityUploadURL();
      const objectPath = this.objectStorage.normalizeObjectEntityPath(uploadUrl);
      const fileUuid = randomUUID();

      await this.logActivity(userId, null, "upload_initiated", {
        filename,
        contentType,
        folderId,
        objectPath,
      });

      return {
        uploadUrl,
        objectPath,
        fileUuid,
      };
    } catch (error) {
      if (error instanceof LibraryServiceError) {
        throw error;
      }
      console.error("Error generating upload URL:", error);
      throw new LibraryServiceError(
        "Failed to generate upload URL",
        "UPLOAD_URL_GENERATION_FAILED",
        500
      );
    }
  }

  async saveFileMetadata(
    userId: string,
    storagePath: string,
    metadata: FileMetadata
  ): Promise<LibraryFile> {
    if (!userId) {
      throw new LibraryServiceError(
        "User ID is required",
        "INVALID_USER_ID",
        400
      );
    }

    if (!storagePath) {
      throw new LibraryServiceError(
        "Storage path is required",
        "INVALID_STORAGE_PATH",
        400
      );
    }

    try {
      const fileData: InsertLibraryFile = {
        uuid: randomUUID(),
        name: metadata.name,
        originalName: metadata.originalName,
        description: metadata.description || null,
        type: metadata.type,
        mimeType: metadata.mimeType,
        extension: metadata.extension,
        storagePath: storagePath,
        storageUrl: `/objects/${storagePath.replace(/^\/objects\//, "")}`,
        size: metadata.size,
        width: metadata.width || null,
        height: metadata.height || null,
        duration: metadata.duration || null,
        pages: metadata.pages || null,
        metadata: metadata.metadata || null,
        tags: metadata.tags || [],
        userId: userId,
        isFavorite: false,
        isArchived: false,
        isPinned: false,
        isPublic: false,
        version: 1,
      };

      const [newFile] = await db
        .insert(libraryFiles)
        .values(fileData)
        .returning();

      await this.logActivity(userId, newFile.id, "file_uploaded", {
        name: metadata.name,
        type: metadata.type,
        size: metadata.size,
      });

      await this.updateStorageStats(userId);

      return newFile;
    } catch (error) {
      console.error("Error saving file metadata:", error);
      throw new LibraryServiceError(
        "Failed to save file metadata",
        "METADATA_SAVE_FAILED",
        500
      );
    }
  }

  async deleteFile(userId: string, fileId: string): Promise<boolean> {
    if (!userId) {
      throw new LibraryServiceError(
        "User ID is required",
        "INVALID_USER_ID",
        400
      );
    }

    if (!fileId) {
      throw new LibraryServiceError(
        "File ID is required",
        "INVALID_FILE_ID",
        400
      );
    }

    try {
      const [file] = await db
        .select()
        .from(libraryFiles)
        .where(
          and(eq(libraryFiles.uuid, fileId), eq(libraryFiles.userId, userId))
        )
        .limit(1);

      if (!file) {
        throw new LibraryServiceError(
          "File not found or access denied",
          "FILE_NOT_FOUND",
          404
        );
      }

      try {
        if (file.storagePath) {
          const objectFile = await this.objectStorage.getObjectEntityFile(
            file.storagePath
          );
          await objectFile.delete();
        }
      } catch (storageError) {
        if (!(storageError instanceof ObjectNotFoundError)) {
          console.error("Error deleting file from object storage:", storageError);
        }
      }

      await db.delete(libraryFiles).where(eq(libraryFiles.id, file.id));

      await this.logActivity(userId, file.id, "file_deleted", {
        name: file.name,
        type: file.type,
        size: file.size,
      });

      await this.updateStorageStats(userId);

      return true;
    } catch (error) {
      if (error instanceof LibraryServiceError) {
        throw error;
      }
      console.error("Error deleting file:", error);
      throw new LibraryServiceError(
        "Failed to delete file",
        "DELETE_FAILED",
        500
      );
    }
  }

  async getFileUrl(userId: string, fileId: string): Promise<string> {
    if (!userId) {
      throw new LibraryServiceError(
        "User ID is required",
        "INVALID_USER_ID",
        400
      );
    }

    if (!fileId) {
      throw new LibraryServiceError(
        "File ID is required",
        "INVALID_FILE_ID",
        400
      );
    }

    try {
      const [file] = await db
        .select()
        .from(libraryFiles)
        .where(
          and(eq(libraryFiles.uuid, fileId), eq(libraryFiles.userId, userId))
        )
        .limit(1);

      if (!file) {
        throw new LibraryServiceError(
          "File not found or access denied",
          "FILE_NOT_FOUND",
          404
        );
      }

      if (file.storageUrl) {
        return file.storageUrl;
      }

      if (file.storagePath) {
        return `/objects/${file.storagePath.replace(/^\/objects\//, "")}`;
      }

      throw new LibraryServiceError(
        "File storage path not available",
        "STORAGE_PATH_MISSING",
        500
      );
    } catch (error) {
      if (error instanceof LibraryServiceError) {
        throw error;
      }
      console.error("Error getting file URL:", error);
      throw new LibraryServiceError(
        "Failed to get file URL",
        "GET_URL_FAILED",
        500
      );
    }
  }

  async updateStorageStats(userId: string): Promise<LibraryStorageStats> {
    if (!userId) {
      throw new LibraryServiceError(
        "User ID is required",
        "INVALID_USER_ID",
        400
      );
    }

    try {
      const statsResult = await db
        .select({
          totalBytes: sql<number>`COALESCE(SUM(${libraryFiles.size}), 0)::bigint`,
          imageBytes: sql<number>`COALESCE(SUM(CASE WHEN ${libraryFiles.type} = 'image' THEN ${libraryFiles.size} ELSE 0 END), 0)::bigint`,
          videoBytes: sql<number>`COALESCE(SUM(CASE WHEN ${libraryFiles.type} = 'video' THEN ${libraryFiles.size} ELSE 0 END), 0)::bigint`,
          documentBytes: sql<number>`COALESCE(SUM(CASE WHEN ${libraryFiles.type} = 'document' THEN ${libraryFiles.size} ELSE 0 END), 0)::bigint`,
          otherBytes: sql<number>`COALESCE(SUM(CASE WHEN ${libraryFiles.type} NOT IN ('image', 'video', 'document') THEN ${libraryFiles.size} ELSE 0 END), 0)::bigint`,
          fileCount: sql<number>`COUNT(*)::int`,
        })
        .from(libraryFiles)
        .where(
          and(
            eq(libraryFiles.userId, userId),
            isNull(libraryFiles.deletedAt)
          )
        );

      const stats = statsResult[0] || {
        totalBytes: 0,
        imageBytes: 0,
        videoBytes: 0,
        documentBytes: 0,
        otherBytes: 0,
        fileCount: 0,
      };

      const [existingStats] = await db
        .select()
        .from(libraryStorage)
        .where(eq(libraryStorage.userId, userId))
        .limit(1);

      let updatedStats: LibraryStorageStats;

      if (existingStats) {
        const [updated] = await db
          .update(libraryStorage)
          .set({
            totalBytes: stats.totalBytes,
            imageBytes: stats.imageBytes,
            videoBytes: stats.videoBytes,
            documentBytes: stats.documentBytes,
            otherBytes: stats.otherBytes,
            fileCount: stats.fileCount,
            updatedAt: new Date(),
          })
          .where(eq(libraryStorage.userId, userId))
          .returning();
        updatedStats = updated;
      } else {
        const [created] = await db
          .insert(libraryStorage)
          .values({
            userId,
            totalBytes: stats.totalBytes,
            imageBytes: stats.imageBytes,
            videoBytes: stats.videoBytes,
            documentBytes: stats.documentBytes,
            otherBytes: stats.otherBytes,
            fileCount: stats.fileCount,
            quotaBytes: 5368709120,
          })
          .returning();
        updatedStats = created;
      }

      return updatedStats;
    } catch (error) {
      console.error("Error updating storage stats:", error);
      throw new LibraryServiceError(
        "Failed to update storage stats",
        "STATS_UPDATE_FAILED",
        500
      );
    }
  }

  async getStorageStats(userId: string): Promise<LibraryStorageStats | null> {
    if (!userId) {
      throw new LibraryServiceError(
        "User ID is required",
        "INVALID_USER_ID",
        400
      );
    }

    try {
      const [stats] = await db
        .select()
        .from(libraryStorage)
        .where(eq(libraryStorage.userId, userId))
        .limit(1);

      if (!stats) {
        return await this.updateStorageStats(userId);
      }

      return stats;
    } catch (error) {
      console.error("Error getting storage stats:", error);
      throw new LibraryServiceError(
        "Failed to get storage stats",
        "STATS_GET_FAILED",
        500
      );
    }
  }

  async getFile(userId: string, fileId: string): Promise<LibraryFile | null> {
    if (!userId || !fileId) {
      return null;
    }

    try {
      const [file] = await db
        .select()
        .from(libraryFiles)
        .where(
          and(eq(libraryFiles.uuid, fileId), eq(libraryFiles.userId, userId))
        )
        .limit(1);

      return file || null;
    } catch (error) {
      console.error("Error getting file:", error);
      return null;
    }
  }

  async getUserFiles(
    userId: string,
    options?: {
      type?: string;
      folderId?: number;
      limit?: number;
      offset?: number;
    }
  ): Promise<LibraryFile[]> {
    if (!userId) {
      return [];
    }

    try {
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

      if (options?.limit) {
        query = query.limit(options.limit) as typeof query;
      }

      if (options?.offset) {
        query = query.offset(options.offset) as typeof query;
      }

      const files = await query;

      if (options?.type) {
        return files.filter((f) => f.type === options.type);
      }

      if (options?.folderId) {
        return files.filter((f) => f.folderId === options.folderId);
      }

      return files;
    } catch (error) {
      console.error("Error getting user files:", error);
      return [];
    }
  }

  private async logActivity(
    userId: string,
    fileId: number | null,
    action: string,
    details?: Record<string, any>
  ): Promise<void> {
    try {
      await db.insert(libraryActivity).values({
        userId,
        fileId,
        action,
        details: details || null,
      });
    } catch (error) {
      console.error("Error logging activity:", error);
    }
  }

  /**
   * Export the user's entire library metadata as a structured JSON object
   */
  async exportLibraryMetadata(userId: string): Promise<any> {
    if (!userId) {
      throw new LibraryServiceError("User ID is required", "UNAUTHORIZED", 401);
    }

    try {
      // 1. Get all folders
      const folders = await db
        .select()
        .from(libraryFolders)
        .where(
          and(
            eq(libraryFolders.userId, userId),
            isNull(libraryFolders.deletedAt)
          )
        );

      // 2. Get all files
      const files = await db
        .select()
        .from(libraryFiles)
        .where(
          and(
            eq(libraryFiles.userId, userId),
            isNull(libraryFiles.deletedAt)
          )
        );

      // 3. Structure into a hierarchy
      const rootFiles = files.filter(f => !f.folderId).map(f => this.formatFileForExport(f));

      const structuredFolders = folders.map(folder => {
        const folderFiles = files
          .filter(f => f.folderId === folder.id)
          .map(f => this.formatFileForExport(f));

        return {
          id: folder.id,
          name: folder.name,
          color: folder.color,
          createdAt: folder.createdAt,
          updatedAt: folder.updatedAt,
          files: folderFiles
        };
      });

      return {
        exportDate: new Date().toISOString(),
        totalFiles: files.length,
        totalFolders: folders.length,
        rootFiles,
        folders: structuredFolders
      };

    } catch (error) {
      console.error("Error exporting library metadata:", error);
      throw new LibraryServiceError("Failed to export library metadata", "EXPORT_FAILED");
    }
  }

  private formatFileForExport(file: LibraryFile): any {
    return {
      id: file.id,
      name: file.name,
      description: file.description,
      type: file.type,
      size: file.size,
      mimeType: file.mimeType,
      createdAt: file.createdAt,
      updatedAt: file.updatedAt,
      tags: file.tags || [],
      metadata: file.metadata || {},
      downloadUrlPath: `/api/library/files/${file.id}/download`
    };
  }
}

export const libraryService = new LibraryService();
