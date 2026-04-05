import { useState, useEffect, useCallback, useRef } from "react";
import { apiFetch } from "@/lib/apiClient";

export interface UserSettings {
  // Display
  appearance: "system" | "light" | "dark";
  accentColor:
    | "default"
    | "blue"
    | "green"
    | "purple"
    | "orange"
    | "pink"
    | "red"
    | "teal"
    | "yellow"
    | "indigo";
  fontSize: "small" | "medium" | "large";
  density: "compact" | "comfortable" | "spacious";
  
  // Language & Region
  spokenLanguage: string;
  dateFormat: "dd/mm/yyyy" | "mm/dd/yyyy" | "yyyy-mm-dd";
  timeFormat: "12h" | "24h";
  timezone: string;
  
  // Voice & Audio
  voice: string;
  voiceSpeed: number;
  voiceVolume: number;
  independentVoiceMode: boolean;
  autoPlayResponses: boolean;
  
  // AI Models
  showAdditionalModels: boolean;
  defaultModel: string;
  streamResponses: boolean;
  
  // Keyboard & Accessibility
  keyboardShortcuts: boolean;
  reducedMotion: boolean;
  highContrast: boolean;
  
  // Notifications
  notifResponses: "push" | "email" | "push_email" | "none";
  notifTasks: "push" | "email" | "push_email" | "none";
  notifProjects: "push" | "email" | "push_email" | "none";
  notifRecommendations: "push" | "email" | "push_email" | "none";
  notifInApp: boolean;
  notifSound: boolean;
  notifDesktop: boolean;
  notifQuietHours: boolean;
  notifQuietStart: string; // HH:MM
  notifQuietEnd: string; // HH:MM
  
  // Personalization
  styleAndTone: "default" | "formal" | "casual" | "concise";
  customInstructions: string;
  nickname: string;
  occupation: string;
  aboutYou: string;
  allowMemories: boolean;
  allowRecordings: boolean;
  webSearch: boolean;
  codeInterpreter: boolean;
  canvas: boolean;
  voiceMode: boolean;
  advancedVoice: boolean;
  connectorSearch: boolean;
  
  // Data controls
  improveModel: boolean;
  remoteBrowser: boolean;
  shareLocation: boolean;
  
  // Security
  authApp: boolean;
  pushNotifications: boolean;
  
  // Account
  showName: boolean;
  receiveEmailComments: boolean;
  linkedInUrl: string;
  githubUrl: string;
  websiteDomain: string;
}

interface ApiUserSettings {
  userId: string;
  responsePreferences: {
    responseStyle: string;
    responseTone?: string;
    customInstructions: string;
  };
  userProfile: {
    nickname: string;
    occupation: string;
    bio: string;
    // Builder profile (optional for backwards compatibility)
    showName?: boolean;
    linkedInUrl?: string;
    githubUrl?: string;
    websiteDomain?: string;
    receiveEmailComments?: boolean;
  };
  featureFlags: {
    memoryEnabled: boolean;
    recordingHistoryEnabled: boolean;
    webSearchAuto: boolean;
    codeInterpreterEnabled: boolean;
    canvasEnabled: boolean;
    voiceEnabled: boolean;
    voiceAdvanced: boolean;
    connectorSearchAuto: boolean;
  };
}

const defaultSettings: UserSettings = {
  // Display
  appearance: "light",
  accentColor: "default",
  fontSize: "medium",
  density: "comfortable",
  
  // Language & Region
  spokenLanguage: "auto",
  dateFormat: "dd/mm/yyyy",
  timeFormat: "24h",
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  
  // Voice & Audio
  voice: "cove",
  voiceSpeed: 1.0,
  voiceVolume: 1.0,
  independentVoiceMode: false,
  autoPlayResponses: false,
  
  // AI Models
  showAdditionalModels: true,
  // Platform-level default model is applied via PlatformSettings.
  defaultModel: "",
  streamResponses: true,
  
  // Keyboard & Accessibility
  keyboardShortcuts: true,
  reducedMotion: false,
  highContrast: false,
  
  // Notifications
  notifResponses: "push",
  notifTasks: "push_email",
  notifProjects: "email",
  notifRecommendations: "push_email",
  notifInApp: true,
  notifSound: true,
  notifDesktop: false,
  notifQuietHours: false,
  notifQuietStart: "22:00",
  notifQuietEnd: "08:00",
  
  // Personalization
  styleAndTone: "default",
  customInstructions: "",
  nickname: "",
  occupation: "",
  aboutYou: "",
  allowMemories: true,
  allowRecordings: false,
  webSearch: true,
  codeInterpreter: true,
  canvas: true,
  voiceMode: true,
  advancedVoice: false,
  connectorSearch: false,
  
  // Data controls
  improveModel: false,
  remoteBrowser: true,
  shareLocation: false,
  
  // Security
  authApp: false,
  pushNotifications: false,
  
  // Account
  showName: true,
  receiveEmailComments: false,
  linkedInUrl: "",
  githubUrl: "",
  websiteDomain: "",
};

const STORAGE_KEY = "sira_user_settings";
const SYNC_DEBOUNCE_MS = 500;

function loadSettings(): UserSettings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      const merged = { ...defaultSettings, ...parsed };

      // Legacy: older UI stored a sentinel value ("custom") instead of an actual URL.
      if (merged.websiteDomain === "custom") merged.websiteDomain = "";

      return merged;
    }
  } catch (e) {
    console.error("Failed to load settings:", e);
  }
  return defaultSettings;
}

function saveSettings(settings: UserSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (e) {
    console.error("Failed to save settings:", e);
  }
}

function mapLocalToApiSettings(settings: UserSettings): Omit<ApiUserSettings, 'userId'> {
  return {
    responsePreferences: {
      responseStyle: settings.styleAndTone,
      customInstructions: settings.customInstructions,
    },
    userProfile: {
      nickname: settings.nickname,
      occupation: settings.occupation,
      bio: settings.aboutYou,
      showName: settings.showName,
      linkedInUrl: settings.linkedInUrl,
      githubUrl: settings.githubUrl,
      websiteDomain: settings.websiteDomain,
      receiveEmailComments: settings.receiveEmailComments,
    },
    featureFlags: {
      memoryEnabled: settings.allowMemories,
      recordingHistoryEnabled: settings.allowRecordings,
      webSearchAuto: settings.webSearch,
      codeInterpreterEnabled: settings.codeInterpreter,
      canvasEnabled: settings.canvas,
      voiceEnabled: settings.voiceMode,
      voiceAdvanced: settings.advancedVoice,
      connectorSearchAuto: settings.connectorSearch,
    },
  };
}

function mapApiToLocalSettings(apiSettings: ApiUserSettings): Partial<UserSettings> {
  return {
    styleAndTone: (apiSettings.responsePreferences?.responseStyle as UserSettings['styleAndTone']) || 'default',
    customInstructions: apiSettings.responsePreferences?.customInstructions || '',
    nickname: apiSettings.userProfile?.nickname || '',
    occupation: apiSettings.userProfile?.occupation || '',
    aboutYou: apiSettings.userProfile?.bio || '',
    showName: apiSettings.userProfile?.showName ?? true,
    linkedInUrl: apiSettings.userProfile?.linkedInUrl || '',
    githubUrl: apiSettings.userProfile?.githubUrl || '',
    websiteDomain: apiSettings.userProfile?.websiteDomain || '',
    receiveEmailComments: apiSettings.userProfile?.receiveEmailComments ?? false,
    allowMemories: apiSettings.featureFlags?.memoryEnabled ?? true,
    allowRecordings: apiSettings.featureFlags?.recordingHistoryEnabled ?? false,
    webSearch: apiSettings.featureFlags?.webSearchAuto ?? true,
    codeInterpreter: apiSettings.featureFlags?.codeInterpreterEnabled ?? true,
    canvas: apiSettings.featureFlags?.canvasEnabled ?? true,
    voiceMode: apiSettings.featureFlags?.voiceEnabled ?? true,
    advancedVoice: apiSettings.featureFlags?.voiceAdvanced ?? false,
    connectorSearch: apiSettings.featureFlags?.connectorSearchAuto ?? false,
  };
}

async function fetchUserSettings(userId: string): Promise<ApiUserSettings | null> {
  try {
    const response = await apiFetch(`/api/users/${userId}/settings`);
    if (!response.ok) {
      if (response.status === 401) {
        return null;
      }
      console.warn("Failed to fetch settings from server:", response.status);
      return null;
    }
    return await response.json();
  } catch (e) {
    console.error("Error fetching settings from server:", e);
    return null;
  }
}

async function saveUserSettings(userId: string, settings: Omit<ApiUserSettings, 'userId'>): Promise<boolean> {
  try {
    const response = await apiFetch(`/api/users/${userId}/settings`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(settings),
    });
    if (!response.ok) {
      console.error("Failed to save settings to server:", response.status);
      return false;
    }
    return true;
  } catch (e) {
    console.error("Error saving settings to server:", e);
    return false;
  }
}

export function useSettings(userId?: string | null) {
  const [settings, setSettingsState] = useState<UserSettings>(loadSettings);
  const [isSyncing, setIsSyncing] = useState(false);
  const syncTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastSyncedRef = useRef<string>('');
  const prevUserIdRef = useRef<string | null | undefined>(undefined);
  // Ref to track current settings without causing callback recreation
  const settingsRef = useRef<UserSettings>(settings);
  settingsRef.current = settings;

  const syncSettingsToServer = useCallback(async (settingsToSync?: UserSettings): Promise<boolean> => {
    if (!userId) {
      console.log("No user ID found, skipping server sync");
      return false;
    }

    const currentSettings = settingsToSync || settingsRef.current;
    const apiSettings = mapLocalToApiSettings(currentSettings);

    setIsSyncing(true);
    try {
      const success = await saveUserSettings(userId, apiSettings);
      if (success) {
        lastSyncedRef.current = JSON.stringify(apiSettings);
      }
      return success;
    } finally {
      setIsSyncing(false);
    }
  }, [userId]);

  const loadSettingsFromServer = useCallback(async (): Promise<boolean> => {
    if (!userId) {
      console.log("No user ID found, skipping server load");
      return false;
    }

    setIsSyncing(true);
    try {
      const apiSettings = await fetchUserSettings(userId);
      if (apiSettings) {
        const mappedSettings = mapApiToLocalSettings(apiSettings);
        setSettingsState((prev) => {
          const merged = { ...prev, ...mappedSettings };
          saveSettings(merged);
          return merged;
        });
        lastSyncedRef.current = JSON.stringify(mapLocalToApiSettings({ ...settingsRef.current, ...mappedSettings }));
        return true;
      }
      return false;
    } finally {
      setIsSyncing(false);
    }
  }, [userId]);

  const debouncedSyncToServer = useCallback((newSettings: UserSettings) => {
    if (syncTimeoutRef.current) {
      clearTimeout(syncTimeoutRef.current);
    }

    syncTimeoutRef.current = setTimeout(() => {
      const apiSettings = mapLocalToApiSettings(newSettings);
      const currentApiSettingsStr = JSON.stringify(apiSettings);
      
      if (currentApiSettingsStr !== lastSyncedRef.current) {
        syncSettingsToServer(newSettings);
      }
    }, SYNC_DEBOUNCE_MS);
  }, [syncSettingsToServer]);

  const updateSetting = useCallback(<K extends keyof UserSettings>(
    key: K,
    value: UserSettings[K]
  ) => {
    setSettingsState((prev) => {
      if (prev[key] === value) return prev;
      const updated = { ...prev, [key]: value };
      saveSettings(updated);
      debouncedSyncToServer(updated);
      return updated;
    });
  }, [debouncedSyncToServer]);

  const updateSettings = useCallback((updates: Partial<UserSettings>) => {
    setSettingsState((prev) => {
      const updated = { ...prev, ...updates };
      saveSettings(updated);
      debouncedSyncToServer(updated);
      return updated;
    });
  }, [debouncedSyncToServer]);

  const resetSettings = useCallback(() => {
    saveSettings(defaultSettings);
    setSettingsState(defaultSettings);
    debouncedSyncToServer(defaultSettings);
  }, [debouncedSyncToServer]);

  useEffect(() => {
    if (userId && prevUserIdRef.current !== userId) {
      loadSettingsFromServer();
    }
    prevUserIdRef.current = userId;
  }, [userId, loadSettingsFromServer]);

  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && e.newValue) {
        try {
          setSettingsState(JSON.parse(e.newValue));
        } catch {}
      }
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  useEffect(() => {
    return () => {
      if (syncTimeoutRef.current) {
        clearTimeout(syncTimeoutRef.current);
      }
    };
  }, []);

  return {
    settings,
    updateSetting,
    updateSettings,
    resetSettings,
    syncSettingsToServer,
    loadSettingsFromServer,
    isSyncing,
  };
}

export function applyAccentColor(color: UserSettings["accentColor"]) {
  const root = document.documentElement;
  
  const accentColors: Record<UserSettings["accentColor"], { light: string; dark: string }> = {
    default: { light: "0 0% 0%", dark: "0 0% 100%" },
    blue: { light: "217 91% 50%", dark: "217 91% 60%" },
    green: { light: "142 71% 45%", dark: "142 71% 55%" },
    purple: { light: "271 81% 56%", dark: "271 81% 66%" },
    orange: { light: "25 95% 53%", dark: "25 95% 63%" },
    pink: { light: "330 81% 60%", dark: "330 81% 70%" },
    red: { light: "0 84% 60%", dark: "0 84% 70%" },
    teal: { light: "173 80% 40%", dark: "173 80% 50%" },
    yellow: { light: "48 96% 53%", dark: "48 96% 63%" },
    indigo: { light: "239 84% 67%", dark: "239 84% 77%" },
  };
  
  const isDark = root.classList.contains("dark");
  const colors = accentColors[color];
  const primaryColor = isDark ? colors.dark : colors.light;
  
  root.style.setProperty("--primary", primaryColor);
  root.style.setProperty("--ring", primaryColor);
  
  if (color === "default") {
    root.style.removeProperty("--primary");
    root.style.removeProperty("--ring");
  }
}

export function applyTheme(theme: UserSettings["appearance"]) {
  const root = document.documentElement;
  
  if (theme === "system") {
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    root.classList.toggle("dark", prefersDark);
  } else {
    root.classList.toggle("dark", theme === "dark");
  }
}
