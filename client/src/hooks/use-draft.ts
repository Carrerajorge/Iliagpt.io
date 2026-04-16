import { useCallback, useRef, useEffect } from "react";

const STORAGE_KEY = "sira-gpt-drafts";
const DEBOUNCE_DELAY = 500;

type Drafts = Record<string, string>;

function getDrafts(): Drafts {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
}

function setDrafts(drafts: Drafts): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(drafts));
  } catch {
    // localStorage may be full or disabled
  }
}

export function useDraft(chatId: string | null | undefined) {
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const currentTextRef = useRef<string>("");

  const getDraft = useCallback((id: string): string => {
    const drafts = getDrafts();
    return drafts[id] || "";
  }, []);

  const saveDraft = useCallback((id: string, text: string): void => {
    const drafts = getDrafts();
    if (text.trim()) {
      drafts[id] = text;
    } else {
      delete drafts[id];
    }
    setDrafts(drafts);
  }, []);

  const clearDraft = useCallback((id: string): void => {
    const drafts = getDrafts();
    delete drafts[id];
    setDrafts(drafts);
  }, []);

  const saveDraftDebounced = useCallback((id: string, text: string): void => {
    currentTextRef.current = text;
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      saveDraft(id, text);
    }, DEBOUNCE_DELAY);
  }, [saveDraft]);

  const saveImmediately = useCallback((): void => {
    const hadPendingChange = debounceTimerRef.current !== null;
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    if (chatId && hadPendingChange) {
      saveDraft(chatId, currentTextRef.current);
    }
  }, [chatId, saveDraft]);

  useEffect(() => {
    return () => {
      const hadPendingChange = debounceTimerRef.current !== null;
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      if (chatId && hadPendingChange) {
        saveDraft(chatId, currentTextRef.current);
      }
    };
  }, [chatId, saveDraft]);

  const initialDraft = chatId ? getDraft(chatId) : "";

  return {
    initialDraft,
    saveDraft,
    saveDraftDebounced,
    clearDraft,
    getDraft,
    saveImmediately,
    currentTextRef
  };
}
