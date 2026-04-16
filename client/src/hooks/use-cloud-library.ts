import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { useCallback, useState } from 'react';

export type FileType = 'image' | 'video' | 'document' | 'audio' | 'other';

export interface LibraryFile {
  id: number;
  uuid: string;
  name: string;
  originalName: string;
  description: string | null;
  type: string;
  mimeType: string;
  extension: string;
  storagePath: string;
  storageUrl: string | null;
  thumbnailPath: string | null;
  thumbnailUrl: string | null;
  size: number;
  width: number | null;
  height: number | null;
  duration: number | null;
  pages: number | null;
  metadata: Record<string, any> | null;
  folderId: number | null;
  tags: string[] | null;
  isFavorite: boolean;
  isArchived: boolean;
  isPinned: boolean;
  userId: string;
  isPublic: boolean;
  sharedWith: string[] | null;
  createdAt: string;
  updatedAt: string;
  lastAccessedAt: string | null;
  deletedAt: string | null;
  version: number;
  parentVersionId: number | null;
}

export interface LibraryFolder {
  id: number;
  uuid: string;
  name: string;
  description: string | null;
  color: string;
  icon: string;
  parentId: number | null;
  path: string;
  userId: string;
  isSystem: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface LibraryCollection {
  id: number;
  uuid: string;
  name: string;
  description: string | null;
  coverFileId: number | null;
  type: string;
  smartRules: {
    conditions: { field: string; operator: string; value: any }[];
    matchAll: boolean;
  } | null;
  userId: string;
  isPublic: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface StorageStats {
  id: number;
  userId: string;
  totalBytes: number;
  imageBytes: number;
  videoBytes: number;
  documentBytes: number;
  otherBytes: number;
  fileCount: number;
  quotaBytes: number;
  updatedAt: string;
}

export interface UploadProgress {
  fileId: string;
  fileName: string;
  progress: number;
  status: 'pending' | 'uploading' | 'completing' | 'done' | 'error';
  error?: string;
}

export interface FileFilters {
  type?: FileType;
  folder?: number;
  search?: string;
  limit?: number;
  offset?: number;
}

interface UploadUrlResponse {
  uploadUrl: string;
  storagePath: string;
  expiresAt: string;
}

interface FileMetadata {
  name: string;
  originalName: string;
  description?: string;
  type?: string;
  mimeType?: string;
  extension?: string;
  size?: number;
  width?: number;
  height?: number;
  duration?: number;
  pages?: number;
  tags?: string[];
  metadata?: Record<string, any>;
}

const QUERY_KEYS = {
  files: '/api/library/files',
  folders: '/api/library/folders',
  collections: '/api/library/collections',
  stats: '/api/library/stats',
};

export interface LibraryError {
  code: 'UNAUTHORIZED' | 'NOT_FOUND' | 'SERVER_ERROR' | 'NETWORK_ERROR';
  message: string;
  status?: number;
}

interface FetchResult<T> {
  data: T | null;
  error: LibraryError | null;
  isAuthenticated: boolean;
}

async function fetchWithAuth<T>(url: string): Promise<FetchResult<T>> {
  try {
    const response = await fetch(url, { credentials: 'include' });
    if (response.status === 401) {
      return { 
        data: null, 
        error: { code: 'UNAUTHORIZED', message: 'Authentication required', status: 401 },
        isAuthenticated: false 
      };
    }
    if (response.status === 404) {
      return { 
        data: null, 
        error: { code: 'NOT_FOUND', message: 'Resource not found', status: 404 },
        isAuthenticated: true 
      };
    }
    if (!response.ok) {
      return { 
        data: null, 
        error: { code: 'SERVER_ERROR', message: `HTTP ${response.status}: ${response.statusText}`, status: response.status },
        isAuthenticated: true 
      };
    }
    const data = await response.json();
    return { data, error: null, isAuthenticated: true };
  } catch (error) {
    console.error(`Failed to fetch ${url}:`, error);
    return { 
      data: null, 
      error: { code: 'NETWORK_ERROR', message: error instanceof Error ? error.message : 'Network error' },
      isAuthenticated: true 
    };
  }
}

export function useCloudLibrary(filters?: FileFilters) {
  const queryClient = useQueryClient();
  const [uploadProgress, setUploadProgress] = useState<Map<string, UploadProgress>>(new Map());

  const buildFilesUrl = useCallback(() => {
    const params = new URLSearchParams();
    if (filters?.type) params.set('type', filters.type);
    if (filters?.folder) params.set('folder', filters.folder.toString());
    if (filters?.search) params.set('search', filters.search);
    if (filters?.limit) params.set('limit', filters.limit.toString());
    if (filters?.offset) params.set('offset', filters.offset.toString());
    const queryString = params.toString();
    return queryString ? `${QUERY_KEYS.files}?${queryString}` : QUERY_KEYS.files;
  }, [filters]);

  const filesQuery = useQuery<FetchResult<LibraryFile[]>>({
    queryKey: [QUERY_KEYS.files, filters],
    queryFn: () => fetchWithAuth<LibraryFile[]>(buildFilesUrl()),
    staleTime: 30000,
    gcTime: 5 * 60 * 1000,
  });

  const foldersQuery = useQuery<FetchResult<LibraryFolder[]>>({
    queryKey: [QUERY_KEYS.folders],
    queryFn: () => fetchWithAuth<LibraryFolder[]>(QUERY_KEYS.folders),
    staleTime: 60000,
  });

  const collectionsQuery = useQuery<FetchResult<LibraryCollection[]>>({
    queryKey: [QUERY_KEYS.collections],
    queryFn: () => fetchWithAuth<LibraryCollection[]>(QUERY_KEYS.collections),
    staleTime: 60000,
  });

  const statsQuery = useQuery<FetchResult<StorageStats>>({
    queryKey: [QUERY_KEYS.stats],
    queryFn: () => fetchWithAuth<StorageStats>(QUERY_KEYS.stats),
    staleTime: 30000,
  });

  const uploadFileMutation = useMutation({
    mutationFn: async ({
      file,
      folderId,
      metadata,
    }: {
      file: File;
      folderId?: number;
      metadata?: Partial<FileMetadata>;
    }): Promise<LibraryFile> => {
      const uploadId = `upload-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      
      setUploadProgress((prev) => {
        const next = new Map(prev);
        next.set(uploadId, {
          fileId: uploadId,
          fileName: file.name,
          progress: 0,
          status: 'pending',
        });
        return next;
      });

      try {
        const urlResponse = await apiRequest('POST', '/api/library/upload/request-url', {
          filename: file.name,
          contentType: file.type || 'application/octet-stream',
          folderId,
        });
        const urlData: UploadUrlResponse = await urlResponse.json();

        setUploadProgress((prev) => {
          const next = new Map(prev);
          next.set(uploadId, { ...prev.get(uploadId)!, status: 'uploading', progress: 10 });
          return next;
        });

        const xhr = new XMLHttpRequest();
        await new Promise<void>((resolve, reject) => {
          xhr.upload.onprogress = (event) => {
            if (event.lengthComputable) {
              const pct = Math.round((event.loaded / event.total) * 80) + 10;
              setUploadProgress((prev) => {
                const next = new Map(prev);
                next.set(uploadId, { ...prev.get(uploadId)!, progress: pct });
                return next;
              });
            }
          };

          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              resolve();
            } else {
              reject(new Error(`Upload failed with status ${xhr.status}`));
            }
          };

          xhr.onerror = () => reject(new Error('Network error during upload'));
          xhr.open('PUT', urlData.uploadUrl);
          xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
          xhr.send(file);
        });

        setUploadProgress((prev) => {
          const next = new Map(prev);
          next.set(uploadId, { ...prev.get(uploadId)!, status: 'completing', progress: 95 });
          return next;
        });

        const ext = file.name.split('.').pop() || '';
        const fileType = getFileTypeFromMime(file.type);

        const completeResponse = await apiRequest('POST', '/api/library/upload/complete', {
          storagePath: urlData.storagePath,
          metadata: {
            name: metadata?.name || file.name.replace(/\.[^/.]+$/, ''),
            originalName: file.name,
            description: metadata?.description,
            type: fileType,
            mimeType: file.type || 'application/octet-stream',
            extension: ext,
            size: file.size,
            width: metadata?.width,
            height: metadata?.height,
            duration: metadata?.duration,
            pages: metadata?.pages,
            tags: metadata?.tags,
            metadata: metadata?.metadata,
          },
        });

        const savedFile: LibraryFile = await completeResponse.json();

        setUploadProgress((prev) => {
          const next = new Map(prev);
          next.set(uploadId, { ...prev.get(uploadId)!, status: 'done', progress: 100 });
          return next;
        });

        setTimeout(() => {
          setUploadProgress((prev) => {
            const next = new Map(prev);
            next.delete(uploadId);
            return next;
          });
        }, 3000);

        return savedFile;
      } catch (error: any) {
        setUploadProgress((prev) => {
          const next = new Map(prev);
          next.set(uploadId, {
            ...prev.get(uploadId)!,
            status: 'error',
            error: error.message || 'Upload failed',
          });
          return next;
        });
        throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.files] });
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.stats] });
    },
  });

  const deleteFileMutation = useMutation({
    mutationFn: async (fileId: string) => {
      await apiRequest('DELETE', `/api/library/files/${fileId}`);
    },
    onMutate: async (fileId) => {
      await queryClient.cancelQueries({ queryKey: [QUERY_KEYS.files] });
      const previousData = queryClient.getQueryData<FetchResult<LibraryFile[]>>([QUERY_KEYS.files, filters]);
      queryClient.setQueryData<FetchResult<LibraryFile[]>>([QUERY_KEYS.files, filters], (old) => {
        if (!old) return { data: [], error: null, isAuthenticated: true };
        return {
          ...old,
          data: (old.data ?? []).filter((f) => f.uuid !== fileId),
        };
      });
      return { previousData };
    },
    onError: (_err, _fileId, context) => {
      if (context?.previousData) {
        queryClient.setQueryData([QUERY_KEYS.files, filters], context.previousData);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.files] });
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.stats] });
    },
  });

  const updateFileMutation = useMutation({
    mutationFn: async ({
      fileId,
      updates,
    }: {
      fileId: string;
      updates: Partial<{
        name: string;
        description: string;
        tags: string[];
        folderId: number | null;
        isFavorite: boolean;
        isPinned: boolean;
        isArchived: boolean;
        isPublic: boolean;
        metadata: Record<string, any>;
      }>;
    }) => {
      const response = await apiRequest('PUT', `/api/library/files/${fileId}`, updates);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.files] });
    },
  });

  const getDownloadUrl = async (fileId: string): Promise<string | null> => {
    try {
      const response = await fetch(`/api/library/files/${fileId}/download`, {
        credentials: 'include',
      });
      if (!response.ok) return null;
      const data = await response.json();
      return data.downloadUrl;
    } catch {
      return null;
    }
  };

  const createFolderMutation = useMutation({
    mutationFn: async (data: {
      name: string;
      description?: string;
      color?: string;
      icon?: string;
      parentId?: number;
    }) => {
      const response = await apiRequest('POST', QUERY_KEYS.folders, data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.folders] });
    },
  });

  const updateFolderMutation = useMutation({
    mutationFn: async ({
      folderId,
      updates,
    }: {
      folderId: string;
      updates: Partial<{ name: string; description: string; color: string; icon: string }>;
    }) => {
      const response = await apiRequest('PUT', `${QUERY_KEYS.folders}/${folderId}`, updates);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.folders] });
    },
  });

  const deleteFolderMutation = useMutation({
    mutationFn: async (folderId: string) => {
      await apiRequest('DELETE', `${QUERY_KEYS.folders}/${folderId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.folders] });
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.files] });
    },
  });

  const createCollectionMutation = useMutation({
    mutationFn: async (data: {
      name: string;
      description?: string;
      type?: string;
      coverFileId?: number;
      smartRules?: { conditions: { field: string; operator: string; value: any }[]; matchAll: boolean };
      isPublic?: boolean;
    }) => {
      const response = await apiRequest('POST', QUERY_KEYS.collections, data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.collections] });
    },
  });

  const updateCollectionMutation = useMutation({
    mutationFn: async ({
      collectionId,
      updates,
    }: {
      collectionId: string;
      updates: Partial<{
        name: string;
        description: string;
        type: string;
        coverFileId: number;
        smartRules: { conditions: { field: string; operator: string; value: any }[]; matchAll: boolean };
        isPublic: boolean;
      }>;
    }) => {
      const response = await apiRequest('PUT', `${QUERY_KEYS.collections}/${collectionId}`, updates);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.collections] });
    },
  });

  const deleteCollectionMutation = useMutation({
    mutationFn: async (collectionId: string) => {
      await apiRequest('DELETE', `${QUERY_KEYS.collections}/${collectionId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.collections] });
    },
  });

  const addFileToCollectionMutation = useMutation({
    mutationFn: async ({ collectionId, fileId, order }: { collectionId: string; fileId: string; order?: number }) => {
      const response = await apiRequest('POST', `${QUERY_KEYS.collections}/${collectionId}/files`, {
        fileId,
        order,
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.collections] });
    },
  });

  const removeFileFromCollectionMutation = useMutation({
    mutationFn: async ({ collectionId, fileId }: { collectionId: string; fileId: string }) => {
      await apiRequest('DELETE', `${QUERY_KEYS.collections}/${collectionId}/files/${fileId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.collections] });
    },
  });

  const isAuthenticated = filesQuery.data?.isAuthenticated ?? true;
  const libraryError = filesQuery.data?.error ?? null;

  return {
    files: filesQuery.data?.data ?? [],
    folders: foldersQuery.data?.data ?? [],
    collections: collectionsQuery.data?.data ?? [],
    stats: statsQuery.data?.data ?? null,

    isLoading: filesQuery.isLoading,
    isFoldersLoading: foldersQuery.isLoading,
    isCollectionsLoading: collectionsQuery.isLoading,
    isStatsLoading: statsQuery.isLoading,

    isError: filesQuery.isError || !!libraryError,
    error: filesQuery.error,
    libraryError,
    isAuthenticated,

    uploadProgress: Array.from(uploadProgress.values()),

    uploadFile: uploadFileMutation.mutateAsync,
    isUploading: uploadFileMutation.isPending,

    deleteFile: deleteFileMutation.mutateAsync,
    isDeleting: deleteFileMutation.isPending,

    updateFile: updateFileMutation.mutateAsync,
    isUpdating: updateFileMutation.isPending,

    getDownloadUrl,

    createFolder: createFolderMutation.mutateAsync,
    updateFolder: updateFolderMutation.mutateAsync,
    deleteFolder: deleteFolderMutation.mutateAsync,

    createCollection: createCollectionMutation.mutateAsync,
    updateCollection: updateCollectionMutation.mutateAsync,
    deleteCollection: deleteCollectionMutation.mutateAsync,
    addFileToCollection: addFileToCollectionMutation.mutateAsync,
    removeFileFromCollection: removeFileFromCollectionMutation.mutateAsync,

    refetch: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.files] });
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.folders] });
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.collections] });
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.stats] });
    },
  };
}

export function getFileTypeFromMime(mimeType: string): FileType {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (
    mimeType.includes('pdf') ||
    mimeType.includes('document') ||
    mimeType.includes('spreadsheet') ||
    mimeType.includes('presentation') ||
    mimeType.includes('text/')
  ) {
    return 'document';
  }
  return 'other';
}

export function getFileTypeFromExtension(filename: string): FileType {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico', 'heic', 'heif', 'avif'];
  const videoExts = ['mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv', 'wmv', 'flv', 'm4v'];
  const audioExts = ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac', 'wma'];
  const docExts = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'rtf', 'odt', 'ods', 'odp', 'csv'];

  if (imageExts.includes(ext)) return 'image';
  if (videoExts.includes(ext)) return 'video';
  if (audioExts.includes(ext)) return 'audio';
  if (docExts.includes(ext)) return 'document';
  return 'other';
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export function formatStorageUsage(usedBytes: number, quotaBytes: number): string {
  const usedFormatted = formatFileSize(usedBytes);
  const quotaFormatted = formatFileSize(quotaBytes);
  const percentage = quotaBytes > 0 ? Math.round((usedBytes / quotaBytes) * 100) : 0;
  return `${usedFormatted} / ${quotaFormatted} (${percentage}%)`;
}
