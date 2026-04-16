export type PrivacySettings = {
  trainingOptIn: boolean;
  remoteBrowserDataAccess: boolean;
  analyticsTracking: boolean;
  chatHistoryEnabled: boolean;
};

export const DEFAULT_PRIVACY_SETTINGS: PrivacySettings = {
  trainingOptIn: false,
  remoteBrowserDataAccess: false,
  analyticsTracking: true,
  chatHistoryEnabled: true,
};

const PRIVACY_STORAGE_KEY = "ilia_privacy_settings_v1";
export const PRIVACY_SETTINGS_UPDATED_EVENT = "privacy-settings-updated";

let snapshot: PrivacySettings = DEFAULT_PRIVACY_SETTINGS;

function normalizePrivacySettings(input: any): PrivacySettings {
  return {
    trainingOptIn:
      typeof input?.trainingOptIn === "boolean" ? input.trainingOptIn : DEFAULT_PRIVACY_SETTINGS.trainingOptIn,
    remoteBrowserDataAccess:
      typeof input?.remoteBrowserDataAccess === "boolean"
        ? input.remoteBrowserDataAccess
        : DEFAULT_PRIVACY_SETTINGS.remoteBrowserDataAccess,
    analyticsTracking:
      typeof input?.analyticsTracking === "boolean" ? input.analyticsTracking : DEFAULT_PRIVACY_SETTINGS.analyticsTracking,
    chatHistoryEnabled:
      typeof input?.chatHistoryEnabled === "boolean"
        ? input.chatHistoryEnabled
        : DEFAULT_PRIVACY_SETTINGS.chatHistoryEnabled,
  };
}

function readSnapshotFromStorage(): PrivacySettings | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(PRIVACY_STORAGE_KEY);
    if (!raw) return null;
    return normalizePrivacySettings(JSON.parse(raw));
  } catch {
    return null;
  }
}

function persistSnapshotToStorage(next: PrivacySettings | null): void {
  if (typeof window === "undefined") return;
  try {
    if (!next) {
      localStorage.removeItem(PRIVACY_STORAGE_KEY);
      return;
    }
    localStorage.setItem(PRIVACY_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage failures
  }
}

function emitSnapshotUpdated(next: PrivacySettings): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new CustomEvent(PRIVACY_SETTINGS_UPDATED_EVENT, { detail: next }));
  } catch {
    // Ignore
  }
}

// Hydrate snapshot eagerly so non-React code (analytics) can respect prior toggles immediately.
const cached = readSnapshotFromStorage();
if (cached) snapshot = cached;

export function getPrivacySettingsSnapshot(): PrivacySettings {
  return snapshot;
}

export function setPrivacySettingsSnapshot(next: Partial<PrivacySettings> | PrivacySettings | null): PrivacySettings {
  if (next === null) {
    snapshot = DEFAULT_PRIVACY_SETTINGS;
    persistSnapshotToStorage(null);
    emitSnapshotUpdated(snapshot);
    return snapshot;
  }

  snapshot = normalizePrivacySettings({ ...snapshot, ...(next as any) });
  persistSnapshotToStorage(snapshot);

  // Best-effort cleanup for data minimization.
  if (typeof window !== "undefined") {
    if (!snapshot.analyticsTracking) {
      try {
        sessionStorage.removeItem("ilia_workspace_analytics_session");
      } catch {
        // ignore
      }
    }
    if (!snapshot.chatHistoryEnabled) {
      try {
        localStorage.removeItem("sira-gpt-chats");
        localStorage.removeItem("ilia_failed_message_queue");
      } catch {
        // ignore
      }
    }
  }

  emitSnapshotUpdated(snapshot);
  return snapshot;
}

export function clearPrivacySettingsSnapshot(): void {
  setPrivacySettingsSnapshot(null);
}

