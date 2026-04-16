import React, { createContext, useContext, useState, useCallback, useEffect } from "react";

export interface AiProcessStep {
  id: string;
  step: string;
  status: "pending" | "active" | "done";
  category: "planning" | "browsing" | "generation";
  timestamp: Date;
}

export interface PanelSizes {
  chat: number;
  document: number;
  data: number;
}

interface WorkspaceContextType {
  activeDocumentId: string | null;
  activeDataSource: string | null;
  aiProcessSteps: AiProcessStep[];
  panelSizes: PanelSizes;
  setPanelSizes: (sizes: PanelSizes) => void;
  setActiveDocument: (id: string | null) => void;
  setActiveDataSource: (source: string | null) => void;
  updateAiStep: (step: AiProcessStep) => void;
  addAiStep: (step: Omit<AiProcessStep, "id" | "timestamp">) => string;
  clearAiSteps: () => void;
}

const STORAGE_KEY = "workspace-panel-sizes";

const defaultPanelSizes: PanelSizes = {
  chat: 60,
  document: 40,
  data: 20,
};

const WorkspaceContext = createContext<WorkspaceContextType | undefined>(undefined);

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [activeDocumentId, setActiveDocumentId] = useState<string | null>(null);
  const [activeDataSource, setActiveDataSourceState] = useState<string | null>(null);
  const [aiProcessSteps, setAiProcessSteps] = useState<AiProcessStep[]>([]);
  const [panelSizes, setPanelSizesState] = useState<PanelSizes>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch {
      // ignore
    }
    return defaultPanelSizes;
  });

  const setPanelSizes = useCallback((sizes: PanelSizes) => {
    setPanelSizesState(sizes);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(sizes));
    } catch {
      // ignore
    }
  }, []);

  const setActiveDocument = useCallback((id: string | null) => {
    setActiveDocumentId(id);
  }, []);

  const setActiveDataSource = useCallback((source: string | null) => {
    setActiveDataSourceState(source);
  }, []);

  const updateAiStep = useCallback((step: AiProcessStep) => {
    setAiProcessSteps((prev) => {
      const index = prev.findIndex((s) => s.id === step.id);
      if (index === -1) {
        return [...prev, step];
      }
      const updated = [...prev];
      updated[index] = step;
      return updated;
    });
  }, []);

  const addAiStep = useCallback((step: Omit<AiProcessStep, "id" | "timestamp">) => {
    const id = `step-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const newStep: AiProcessStep = {
      ...step,
      id,
      timestamp: new Date(),
    };
    setAiProcessSteps((prev) => [...prev, newStep]);
    return id;
  }, []);

  const clearAiSteps = useCallback(() => {
    setAiProcessSteps([]);
  }, []);

  return (
    <WorkspaceContext.Provider
      value={{
        activeDocumentId,
        activeDataSource,
        aiProcessSteps,
        panelSizes,
        setPanelSizes,
        setActiveDocument,
        setActiveDataSource,
        updateAiStep,
        addAiStep,
        clearAiSteps,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (context === undefined) {
    throw new Error("useWorkspace must be used within a WorkspaceProvider");
  }
  return context;
}
