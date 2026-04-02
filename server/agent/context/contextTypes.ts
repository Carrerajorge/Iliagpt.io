import { randomUUID } from "crypto";

export interface AgentContextIdentity {
  runId: string;
  userId: string;
  chatId: string;
}

export interface MemorySlice {
  shortTerm: Array<{ role: string; content: string; timestamp: number }>;
  workingNotes: string[];
  vectorKeys: string[];
}

export interface CapabilityState<T = Record<string, unknown>> {
  name: string;
  version: number;
  updatedAt: number;
  data: T;
}

export interface AgentRuntimeContext {
  id: string;
  identity: AgentContextIdentity;
  createdAt: number;
  updatedAt: number;
  iteration: number;
  memory: MemorySlice;
  scratchpad: Record<string, any>;
  capabilityState: Record<string, CapabilityState>;
  signals: Array<{ id: string; type: string; payload: any; timestamp: number }>;
}

export type ContextUpdater = (context: AgentRuntimeContext) => AgentRuntimeContext | void;

export const createEmptyRuntimeContext = (identity: AgentContextIdentity): AgentRuntimeContext => ({
  id: randomUUID(),
  identity,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  iteration: 0,
  memory: {
    shortTerm: [],
    workingNotes: [],
    vectorKeys: [],
  },
  scratchpad: {},
  capabilityState: {},
  signals: [],
});
