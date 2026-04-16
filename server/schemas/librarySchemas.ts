import { z } from 'zod';

export const uploadRequestUrlSchema = z.object({
  filename: z.string().min(1, { message: 'Filename is required' }),
  contentType: z.string().optional(),
  folderId: z.string().optional(),
});

export type UploadRequestUrlInput = z.infer<typeof uploadRequestUrlSchema>;

export const fileMetadataSchema = z.object({
  name: z.string().min(1, { message: 'Name is required' }),
  originalName: z.string().min(1, { message: 'Original name is required' }),
  description: z.string().optional(),
  type: z.string().optional(),
  mimeType: z.string().optional(),
  extension: z.string().optional(),
  size: z.number().int().nonnegative().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  duration: z.number().nonnegative().optional(),
  pages: z.number().int().positive().optional(),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const uploadCompleteSchema = z.object({
  storagePath: z.string().min(1, { message: 'Storage path is required' }),
  metadata: fileMetadataSchema,
});

export type UploadCompleteInput = z.infer<typeof uploadCompleteSchema>;

export const createFolderSchema = z.object({
  name: z.string().min(1, { message: 'Folder name is required' }),
  description: z.string().optional(),
  color: z.string().optional(),
  icon: z.string().optional(),
  parentId: z.string().optional(),
});

export type CreateFolderInput = z.infer<typeof createFolderSchema>;

export const updateFolderSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  color: z.string().optional(),
  icon: z.string().optional(),
});

export type UpdateFolderInput = z.infer<typeof updateFolderSchema>;

export const createCollectionSchema = z.object({
  name: z.string().min(1, { message: 'Collection name is required' }),
  description: z.string().optional(),
  type: z.string().optional(),
  coverFileId: z.string().optional(),
  smartRules: z.record(z.unknown()).optional(),
  isPublic: z.boolean().optional(),
});

export type CreateCollectionInput = z.infer<typeof createCollectionSchema>;

export const updateCollectionSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  type: z.string().optional(),
  coverFileId: z.string().optional(),
  smartRules: z.record(z.unknown()).optional(),
  isPublic: z.boolean().optional(),
});

export type UpdateCollectionInput = z.infer<typeof updateCollectionSchema>;

export const addFileToCollectionSchema = z.object({
  fileId: z.string().min(1, { message: 'File ID is required' }),
  order: z.number().int().nonnegative().optional(),
});

export type AddFileToCollectionInput = z.infer<typeof addFileToCollectionSchema>;

export const updateFileSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  folderId: z.number().int().nullable().optional(),
  isFavorite: z.boolean().optional(),
  isPinned: z.boolean().optional(),
  isArchived: z.boolean().optional(),
  isPublic: z.boolean().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type UpdateFileInput = z.infer<typeof updateFileSchema>;

export const libraryFilesQuerySchema = z.object({
  type: z.string().optional(),
  folder: z.string().optional(),
  search: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export type LibraryFilesQueryInput = z.infer<typeof libraryFilesQuerySchema>;

export const uuidParamSchema = z.object({
  id: z.string().min(1, { message: 'ID is required' }),
});

export type UuidParamInput = z.infer<typeof uuidParamSchema>;

export const fileIdParamSchema = z.object({
  id: z.string().min(1, { message: 'ID is required' }),
  fileId: z.string().min(1, { message: 'File ID is required' }),
});

export type FileIdParamInput = z.infer<typeof fileIdParamSchema>;

export const createLibraryItemSchema = z.object({
  mediaType: z.string().min(1, { message: 'Media type is required' }),
  title: z.string().min(1, { message: 'Title is required' }),
  description: z.string().optional(),
  storagePath: z.string().min(1, { message: 'Storage path is required' }),
  thumbnailPath: z.string().optional(),
  mimeType: z.string().optional(),
  size: z.number().int().nonnegative().optional(),
  metadata: z.record(z.unknown()).optional(),
  sourceChatId: z.string().optional(),
});

export type CreateLibraryItemInput = z.infer<typeof createLibraryItemSchema>;
