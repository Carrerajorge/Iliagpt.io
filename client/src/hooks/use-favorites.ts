import { useState, useEffect, useCallback } from "react";

export interface FavoriteMessage {
  id: string;
  chatId: string;
  chatTitle: string;
  content: string;
  role: "user" | "assistant";
  savedAt: Date;
  note?: string;
}

const STORAGE_KEY = "sira-favorites";

function loadFavorites(): FavoriteMessage[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return parsed.map((f: FavoriteMessage) => ({
        ...f,
        savedAt: new Date(f.savedAt),
      }));
    }
  } catch (e) {
    console.error("Error loading favorites:", e);
  }
  return [];
}

function saveFavorites(favorites: FavoriteMessage[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(favorites));
  } catch (e) {
    console.error("Error saving favorites:", e);
  }
}

export function useFavorites() {
  const [favorites, setFavorites] = useState<FavoriteMessage[]>(() => loadFavorites());

  useEffect(() => {
    saveFavorites(favorites);
  }, [favorites]);

  const addFavorite = useCallback(
    (message: Omit<FavoriteMessage, "savedAt">) => {
      setFavorites((prev) => {
        if (prev.some((f) => f.id === message.id)) {
          return prev;
        }
        return [...prev, { ...message, savedAt: new Date() }];
      });
    },
    []
  );

  const removeFavorite = useCallback((id: string) => {
    setFavorites((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const isFavorite = useCallback(
    (id: string) => favorites.some((f) => f.id === id),
    [favorites]
  );

  const updateNote = useCallback((id: string, note: string) => {
    setFavorites((prev) =>
      prev.map((f) => (f.id === id ? { ...f, note } : f))
    );
  }, []);

  return {
    favorites,
    addFavorite,
    removeFavorite,
    isFavorite,
    updateNote,
  };
}
