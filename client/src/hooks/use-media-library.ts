import { create } from 'zustand';
import { 
  MediaItem, 
  saveMediaItem, 
  getAllMediaItems, 
  deleteMediaItem,
  getMediaItemsByType 
} from '@/lib/mediaIndexedDB';
import { generateThumbnailSync } from '@/lib/thumbnailWorkerCode';

const CACHE_LIMIT = 20;

interface MediaLibraryState {
  items: MediaItem[];
  isLoaded: boolean;
  isLoading: boolean;
  totalCount: number;
  filter: 'all' | 'image' | 'video' | 'document';
  
  preload: () => Promise<void>;
  add: (file: File | Blob, type: 'image' | 'video' | 'document', options?: { name?: string; source?: string }) => Promise<MediaItem>;
  remove: (id: string) => Promise<void>;
  setFilter: (filter: 'all' | 'image' | 'video' | 'document') => void;
  loadAll: () => Promise<void>;
  getFilteredItems: () => MediaItem[];
}

export const useMediaLibrary = create<MediaLibraryState>((set, get) => ({
  items: [],
  isLoaded: false,
  isLoading: false,
  totalCount: 0,
  filter: 'all',

  preload: async () => {
    if (get().isLoaded || get().isLoading) return;
    
    set({ isLoading: true });
    try {
      const items = await getAllMediaItems(CACHE_LIMIT);
      const allItems = await getAllMediaItems();
      set({ 
        items, 
        isLoaded: true, 
        isLoading: false,
        totalCount: allItems.length 
      });
    } catch (error) {
      console.error('Failed to preload media library:', error);
      set({ isLoaded: true, isLoading: false });
    }
  },

  add: async (file, type, options = {}) => {
    const id = `media-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const name = options.name || (file instanceof File ? file.name : `file-${id}`);
    
    let thumbnailBase64: string | undefined;
    try {
      thumbnailBase64 = await generateThumbnailSync(file, type) || undefined;
    } catch {
      thumbnailBase64 = undefined;
    }

    const url = URL.createObjectURL(file);
    
    const item: MediaItem = {
      id,
      name,
      type,
      mimeType: file.type || 'application/octet-stream',
      size: file.size,
      url,
      thumbnailBase64,
      createdAt: new Date().toISOString(),
      source: options.source,
    };

    await saveMediaItem(item);
    
    set((state) => ({
      items: [item, ...state.items].slice(0, CACHE_LIMIT),
      totalCount: state.totalCount + 1,
    }));

    return item;
  },

  remove: async (id) => {
    await deleteMediaItem(id);
    set((state) => ({
      items: state.items.filter((item) => item.id !== id),
      totalCount: Math.max(0, state.totalCount - 1),
    }));
  },

  setFilter: (filter) => {
    set({ filter });
  },

  loadAll: async () => {
    set({ isLoading: true });
    try {
      const items = await getAllMediaItems();
      set({ items, isLoading: false, totalCount: items.length });
    } catch (error) {
      console.error('Failed to load all media:', error);
      set({ isLoading: false });
    }
  },

  getFilteredItems: () => {
    const { items, filter } = get();
    if (filter === 'all') return items;
    return items.filter((item) => item.type === filter);
  },
}));

export function getMediaTypeFromMime(mimeType: string): 'image' | 'video' | 'document' {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  return 'document';
}

export function getMediaTypeFromExtension(filename: string): 'image' | 'video' | 'document' {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico'];
  const videoExts = ['mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv'];
  
  if (imageExts.includes(ext)) return 'image';
  if (videoExts.includes(ext)) return 'video';
  return 'document';
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}
