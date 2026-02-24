/**
 * User Preferences Hook
 * 
 * Manages user preferences with local storage fallback
 * and server persistence when authenticated
 */

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest } from "@/lib/queryClient";

export interface UserPreferences {
    // Notifications
    pushNotifications: boolean;
    emailNotifications: boolean;
    soundEffects: boolean;
    
    // Appearance
    theme: "light" | "dark" | "system";
    language: string;
    fontSize: "small" | "medium" | "large";
    
    // AI
    defaultModel?: string;
    streamResponses: boolean;
    showToolUsage: boolean;
    autoSaveChats: boolean;
    
    // Accessibility
    reducedMotion: boolean;
    highContrast: boolean;
    screenReaderOptimized: boolean;
    
    // Custom
    [key: string]: unknown;
}

const DEFAULT_PREFERENCES: UserPreferences = {
    pushNotifications: true,
    emailNotifications: true,
    soundEffects: true,
    theme: "system",
    language: "es",
    fontSize: "medium",
    streamResponses: true,
    showToolUsage: false,
    autoSaveChats: true,
    reducedMotion: false,
    highContrast: false,
    screenReaderOptimized: false
};

const LOCAL_STORAGE_KEY = "iliagpt_user_preferences";

export function usePreferences() {
    const { user, isAuthenticated } = useAuth();
    const [preferences, setPreferencesState] = useState<UserPreferences>(DEFAULT_PREFERENCES);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);

    // Load preferences on mount
    useEffect(() => {
        const loadPreferences = async () => {
            setIsLoading(true);
            
            try {
                // First load from local storage for immediate feedback
                const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
                if (stored) {
                    const parsed = JSON.parse(stored);
                    setPreferencesState({ ...DEFAULT_PREFERENCES, ...parsed });
                }
                
                // If authenticated, load from server
                if (isAuthenticated && user) {
                    const res = await apiRequest("GET", "/api/user/preferences");
                    if (res.ok) {
                        const serverPrefs = await res.json();
                        const merged = { ...DEFAULT_PREFERENCES, ...serverPrefs };
                        setPreferencesState(merged);
                        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(merged));
                    }
                }
            } catch (error) {
                console.error("[Preferences] Error loading:", error);
            } finally {
                setIsLoading(false);
            }
        };
        
        loadPreferences();
    }, [isAuthenticated, user]);

    // Update a single preference
    const setPreference = useCallback(async <K extends keyof UserPreferences>(
        key: K,
        value: UserPreferences[K]
    ) => {
        const newPrefs = { ...preferences, [key]: value };
        setPreferencesState(newPrefs);
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(newPrefs));
        
        // Persist to server if authenticated
        if (isAuthenticated) {
            setIsSaving(true);
            try {
                await apiRequest("PATCH", "/api/user/preferences", { [key]: value });
            } catch (error) {
                console.error("[Preferences] Error saving:", error);
            } finally {
                setIsSaving(false);
            }
        }
    }, [preferences, isAuthenticated]);

    // Update multiple preferences at once
    const setPreferences = useCallback(async (updates: Partial<UserPreferences>) => {
        const newPrefs = { ...preferences, ...updates };
        setPreferencesState(newPrefs);
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(newPrefs));
        
        if (isAuthenticated) {
            setIsSaving(true);
            try {
                await apiRequest("PATCH", "/api/user/preferences", updates);
            } catch (error) {
                console.error("[Preferences] Error saving:", error);
            } finally {
                setIsSaving(false);
            }
        }
    }, [preferences, isAuthenticated]);

    // Reset to defaults
    const resetPreferences = useCallback(async () => {
        setPreferencesState(DEFAULT_PREFERENCES);
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(DEFAULT_PREFERENCES));
        
        if (isAuthenticated) {
            setIsSaving(true);
            try {
                await apiRequest("PUT", "/api/user/preferences", DEFAULT_PREFERENCES);
            } catch (error) {
                console.error("[Preferences] Error resetting:", error);
            } finally {
                setIsSaving(false);
            }
        }
    }, [isAuthenticated]);

    return {
        preferences,
        setPreference,
        setPreferences,
        resetPreferences,
        isLoading,
        isSaving,
        defaults: DEFAULT_PREFERENCES
    };
}

export default usePreferences;
