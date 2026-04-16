import { useState, useCallback, useEffect } from 'react';
import type { ImageSessionState, ImageHistoryEntry, ImageMode } from '@shared/schema';

const STORAGE_KEY_PREFIX = 'iliagpt_image_state_';

function getStorageKey(threadId: string): string {
  return `${STORAGE_KEY_PREFIX}${threadId}`;
}

function createEmptyState(threadId: string): ImageSessionState {
  const now = Date.now();
  return {
    threadId,
    lastImageId: null,
    lastImageUrl: null,
    history: [],
    createdAt: now,
    updatedAt: now,
  };
}

function loadFromStorage(threadId: string): ImageSessionState {
  try {
    const stored = localStorage.getItem(getStorageKey(threadId));
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (e) {
    console.warn('[ImageState] Failed to load from storage:', e);
  }
  return createEmptyState(threadId);
}

function saveToStorage(state: ImageSessionState): void {
  try {
    localStorage.setItem(getStorageKey(state.threadId), JSON.stringify(state));
  } catch (e) {
    console.warn('[ImageState] Failed to save to storage:', e);
  }
}

export interface UseImageStateReturn {
  state: ImageSessionState;
  lastImage: ImageHistoryEntry | null;
  addImage: (entry: Omit<ImageHistoryEntry, 'timestamp'>) => void;
  setLastImage: (imageId: string, imageUrl: string) => void;
  getImageById: (imageId: string) => ImageHistoryEntry | undefined;
  clearHistory: () => void;
  selectForEdit: (imageId: string) => ImageHistoryEntry | undefined;
}

export function useImageState(threadId: string): UseImageStateReturn {
  const [state, setState] = useState<ImageSessionState>(() => loadFromStorage(threadId));

  useEffect(() => {
    if (threadId && threadId !== state.threadId) {
      setState(loadFromStorage(threadId));
    }
  }, [threadId]);

  useEffect(() => {
    if (state.threadId) {
      saveToStorage(state);
    }
  }, [state]);

  const addImage = useCallback((entry: Omit<ImageHistoryEntry, 'timestamp'>) => {
    const newEntry: ImageHistoryEntry = {
      ...entry,
      timestamp: Date.now(),
    };
    
    setState(prev => ({
      ...prev,
      lastImageId: entry.id,
      lastImageUrl: entry.imageUrl,
      history: [...prev.history, newEntry],
      updatedAt: Date.now(),
    }));
  }, []);

  const setLastImage = useCallback((imageId: string, imageUrl: string) => {
    setState(prev => ({
      ...prev,
      lastImageId: imageId,
      lastImageUrl: imageUrl,
      updatedAt: Date.now(),
    }));
  }, []);

  const getImageById = useCallback((imageId: string): ImageHistoryEntry | undefined => {
    return state.history.find(h => h.id === imageId);
  }, [state.history]);

  const clearHistory = useCallback(() => {
    setState(prev => ({
      ...prev,
      lastImageId: null,
      lastImageUrl: null,
      history: [],
      updatedAt: Date.now(),
    }));
  }, []);

  const selectForEdit = useCallback((imageId: string): ImageHistoryEntry | undefined => {
    const image = state.history.find(h => h.id === imageId);
    if (image) {
      setState(prev => ({
        ...prev,
        lastImageId: imageId,
        lastImageUrl: image.imageUrl,
        updatedAt: Date.now(),
      }));
    }
    return image;
  }, [state.history]);

  const lastImage = state.lastImageId 
    ? state.history.find(h => h.id === state.lastImageId) || null
    : null;

  return {
    state,
    lastImage,
    addImage,
    setLastImage,
    getImageById,
    clearHistory,
    selectForEdit,
  };
}

export async function fetchImageAsBase64(imageUrl: string): Promise<string | null> {
  try {
    const response = await fetch(imageUrl);
    if (!response.ok) return null;
    
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = (reader.result as string).split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (e) {
    console.error('[ImageState] Failed to fetch image as base64:', e);
    return null;
  }
}
