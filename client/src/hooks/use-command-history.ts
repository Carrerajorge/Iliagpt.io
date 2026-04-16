import { useState, useCallback, useEffect } from "react";

const STORAGE_KEY = "sira-gpt-command-history";
const MAX_HISTORY_SIZE = 50;

export function useCommandHistory() {
  const [history, setHistory] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  const [currentIndex, setCurrentIndex] = useState<number>(-1);
  const [tempInput, setTempInput] = useState<string>("");

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
    } catch {
    }
  }, [history]);

  const addToHistory = useCallback((text: string) => {
    if (!text.trim()) return;
    
    setHistory((prev) => {
      const filtered = prev.filter((item) => item !== text);
      const newHistory = [text, ...filtered].slice(0, MAX_HISTORY_SIZE);
      return newHistory;
    });
    setCurrentIndex(-1);
    setTempInput("");
  }, []);

  const navigateUp = useCallback((currentInput: string): string | null => {
    if (history.length === 0) return null;

    if (currentIndex === -1) {
      setTempInput(currentInput);
      setCurrentIndex(0);
      return history[0];
    }

    if (currentIndex < history.length - 1) {
      const newIndex = currentIndex + 1;
      setCurrentIndex(newIndex);
      return history[newIndex];
    }

    return null;
  }, [history, currentIndex]);

  const navigateDown = useCallback((): string | null => {
    if (currentIndex === -1) return null;

    if (currentIndex === 0) {
      setCurrentIndex(-1);
      return tempInput;
    }

    if (currentIndex > 0) {
      const newIndex = currentIndex - 1;
      setCurrentIndex(newIndex);
      return history[newIndex];
    }

    return null;
  }, [history, currentIndex, tempInput]);

  const resetNavigation = useCallback(() => {
    setCurrentIndex(-1);
    setTempInput("");
  }, []);

  const getCurrentHistoryItem = useCallback((): string | null => {
    if (currentIndex === -1) return null;
    return history[currentIndex] ?? null;
  }, [history, currentIndex]);

  return {
    history,
    currentIndex,
    addToHistory,
    navigateUp,
    navigateDown,
    resetNavigation,
    getCurrentHistoryItem,
  };
}
