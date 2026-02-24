import React, { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";

export interface ConnectedSource {
  id: string;
  name: string;
  icon: React.ReactNode;
  email?: string;
}

interface GmailStatus {
  connected: boolean;
  email?: string;
}

interface GoogleFormsStatus {
  connected: boolean;
}

const GmailIcon = () => (
  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none">
    <path d="M2 6l10 7 10-7v12H2V6z" fill="#EA4335"/>
    <path d="M22 6l-10 7L2 6" stroke="#FBBC05" strokeWidth="2"/>
  </svg>
);

const GoogleFormsIcon = () => (
  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none">
    <path d="M7.5 3C6.12 3 5 4.12 5 5.5v13C5 19.88 6.12 21 7.5 21h9c1.38 0 2.5-1.12 2.5-2.5v-13C19 4.12 17.88 3 16.5 3h-9z" fill="#673AB7"/>
    <circle cx="9" cy="9" r="1.5" fill="white"/>
    <rect x="12" y="8" width="5" height="2" rx="1" fill="white"/>
    <circle cx="9" cy="13" r="1.5" fill="white"/>
    <rect x="12" y="12" width="5" height="2" rx="1" fill="white"/>
    <circle cx="9" cy="17" r="1.5" fill="white"/>
    <rect x="12" y="16" width="5" height="2" rx="1" fill="white"/>
  </svg>
);

async function fetchConnectedSources(): Promise<ConnectedSource[]> {
  const sources: ConnectedSource[] = [];

  const [gmailRes, formsRes] = await Promise.allSettled([
    fetch("/api/oauth/google/gmail/status", { credentials: "include" }),
    fetch("/api/integrations/google/forms/status", { credentials: "include" }),
  ]);

  if (gmailRes.status === "fulfilled" && gmailRes.value.ok) {
    try {
      const data: GmailStatus = await gmailRes.value.json();
      if (data.connected) {
        sources.push({
          id: "gmail",
          name: "Gmail",
          icon: <GmailIcon />,
          email: data.email,
        });
      }
    } catch {
      // FRONTEND FIX #17: Intentionally silent - continue checking other sources if one fails
    }
  }

  if (formsRes.status === "fulfilled" && formsRes.value.ok) {
    try {
      const data: GoogleFormsStatus = await formsRes.value.json();
      if (data.connected) {
        sources.push({
          id: "googleForms",
          name: "Google Forms",
          icon: <GoogleFormsIcon />,
        });
      }
    } catch {
      // FRONTEND FIX #18: Intentionally silent - continue checking other sources
    }
  }

  return sources;
}

export function useConnectedSources() {
  const [activeSources, setActiveSources] = useState<Record<string, boolean>>({});

  const query = useQuery<ConnectedSource[]>({
    queryKey: ["connected-sources"],
    queryFn: fetchConnectedSources,
    staleTime: 60 * 1000,
    retry: 1,
  });

  const setSourceActive = useCallback((sourceId: string, active: boolean) => {
    setActiveSources((prev) => ({ ...prev, [sourceId]: active }));
  }, []);

  const getSourceActive = useCallback(
    (sourceId: string): boolean => {
      if (sourceId in activeSources) {
        return activeSources[sourceId];
      }
      return true;
    },
    [activeSources]
  );

  return {
    connectedSources: query.data ?? [],
    activeSources,
    setSourceActive,
    getSourceActive,
    isLoading: query.isLoading,
    refetch: query.refetch,
  };
}
