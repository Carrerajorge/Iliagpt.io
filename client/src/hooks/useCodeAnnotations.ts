import { useState, useCallback, useMemo, useEffect } from "react";

export interface CodeAnnotation {
  id: string;
  blockId: string;
  line: number;
  content: string;
  type: 'info' | 'warning' | 'error' | 'explanation';
  createdAt: Date;
}

export interface UseCodeAnnotationsReturn {
  annotations: Map<number, CodeAnnotation>;
  addAnnotation: (line: number, content: string, type?: CodeAnnotation['type']) => void;
  updateAnnotation: (id: string, content: string) => void;
  removeAnnotation: (id: string) => void;
  getAnnotationForLine: (line: number) => CodeAnnotation | undefined;
  getAllAnnotations: () => CodeAnnotation[];
  clearAllAnnotations: () => void;
  hasAnnotation: (line: number) => boolean;
}

const STORAGE_KEY_PREFIX = "code-annotations-";

function serializeAnnotations(annotations: Map<number, CodeAnnotation>): string {
  const arr = Array.from(annotations.entries()).map(([line, annotation]) => ({
    line,
    annotation: {
      ...annotation,
      createdAt: annotation.createdAt.toISOString(),
    },
  }));
  return JSON.stringify(arr);
}

function deserializeAnnotations(json: string): Map<number, CodeAnnotation> {
  try {
    const arr = JSON.parse(json) as Array<{
      line: number;
      annotation: Omit<CodeAnnotation, 'createdAt'> & { createdAt: string };
    }>;
    const map = new Map<number, CodeAnnotation>();
    for (const item of arr) {
      map.set(item.line, {
        ...item.annotation,
        createdAt: new Date(item.annotation.createdAt),
      });
    }
    return map;
  } catch {
    return new Map();
  }
}

export function useCodeAnnotations(blockId: string, persist: boolean = false): UseCodeAnnotationsReturn {
  const storageKey = `${STORAGE_KEY_PREFIX}${blockId}`;

  const [annotations, setAnnotations] = useState<Map<number, CodeAnnotation>>(() => {
    if (persist && typeof window !== "undefined") {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        return deserializeAnnotations(stored);
      }
    }
    return new Map();
  });

  useEffect(() => {
    if (persist && typeof window !== "undefined") {
      localStorage.setItem(storageKey, serializeAnnotations(annotations));
    }
  }, [annotations, persist, storageKey]);

  const addAnnotation = useCallback(
    (line: number, content: string, type: CodeAnnotation['type'] = 'info') => {
      const id = crypto.randomUUID();
      const annotation: CodeAnnotation = {
        id,
        blockId,
        line,
        content,
        type,
        createdAt: new Date(),
      };
      setAnnotations((prev) => {
        const next = new Map(prev);
        next.set(line, annotation);
        return next;
      });
    },
    [blockId]
  );

  const updateAnnotation = useCallback((id: string, content: string) => {
    setAnnotations((prev) => {
      const next = new Map(prev);
      for (const [line, annotation] of next) {
        if (annotation.id === id) {
          next.set(line, { ...annotation, content });
          break;
        }
      }
      return next;
    });
  }, []);

  const removeAnnotation = useCallback((id: string) => {
    setAnnotations((prev) => {
      const next = new Map(prev);
      for (const [line, annotation] of next) {
        if (annotation.id === id) {
          next.delete(line);
          break;
        }
      }
      return next;
    });
  }, []);

  const getAnnotationForLine = useCallback(
    (line: number): CodeAnnotation | undefined => {
      return annotations.get(line);
    },
    [annotations]
  );

  const getAllAnnotations = useCallback((): CodeAnnotation[] => {
    return Array.from(annotations.values()).sort((a, b) => a.line - b.line);
  }, [annotations]);

  const clearAllAnnotations = useCallback(() => {
    setAnnotations(new Map());
    if (persist && typeof window !== "undefined") {
      localStorage.removeItem(storageKey);
    }
  }, [persist, storageKey]);

  const hasAnnotation = useCallback(
    (line: number): boolean => {
      return annotations.has(line);
    },
    [annotations]
  );

  return useMemo(
    () => ({
      annotations,
      addAnnotation,
      updateAnnotation,
      removeAnnotation,
      getAnnotationForLine,
      getAllAnnotations,
      clearAllAnnotations,
      hasAnnotation,
    }),
    [
      annotations,
      addAnnotation,
      updateAnnotation,
      removeAnnotation,
      getAnnotationForLine,
      getAllAnnotations,
      clearAllAnnotations,
      hasAnnotation,
    ]
  );
}

export default useCodeAnnotations;
