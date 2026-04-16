export interface SessionConfig {
  viewport?: { width: number; height: number };
  userAgent?: string;
  timeout?: number;
  allowedDomains?: string[];
  maxDownloadSize?: number;
  enableNetworkCapture?: boolean;
}

export interface BrowserAction {
  type: "navigate" | "click" | "type" | "scroll" | "download" | "screenshot" | "wait" | "evaluate" | "getState";
  params: Record<string, any>;
  timestamp: Date;
}

export interface ActionResult {
  success: boolean;
  action: BrowserAction;
  data?: any;
  screenshot?: string;
  error?: string;
  duration: number;
}

export interface Observation {
  sessionId: string;
  timestamp: Date;
  type: "screenshot" | "dom" | "text" | "network" | "error" | "state";
  data: any;
}

export interface NetworkRequest {
  url: string;
  method: string;
  status?: number;
  mimeType?: string;
  size?: number;
  timing?: number;
}

export interface PageState {
  url: string;
  title: string;
  visibleText: string;
  links: { text: string; href: string }[];
  forms: { action: string; inputs: string[] }[];
  images: { src: string; alt: string }[];
  metaTags: Record<string, string>;
  jsonLd: any[];
}

export interface SessionEvent {
  type: "started" | "action" | "observation" | "error" | "completed" | "cancelled";
  sessionId: string;
  timestamp: Date;
  data: any;
}

export type SessionEventCallback = (event: SessionEvent) => void;

export interface ComputerSession {
  id: string;
  status: "active" | "paused" | "completed" | "error" | "cancelled";
  startedAt: Date;
  objective: string;
  actions: BrowserAction[];
  observations: Observation[];
  currentUrl?: string;
  currentTitle?: string;
  lastScreenshot?: string;
}

export const DEFAULT_SESSION_CONFIG: SessionConfig = {
  viewport: { width: 1280, height: 720 },
  timeout: 30000,
  allowedDomains: [],
  maxDownloadSize: 100 * 1024 * 1024,
  enableNetworkCapture: true
};
