import { useState, useEffect } from "react";

interface OpenClawStatus {
  healthy: boolean;
  modules: { gateway: boolean; tools: number; skills: number; plugins: number; streaming: boolean };
  version: string;
}

export function useOpenClawStatus() {
  const [status, setStatus] = useState<OpenClawStatus | null>(null);

  useEffect(() => {
    fetch("/api/openclaw/health")
      .then(r => r.json())
      .then(data => setStatus({
        healthy: data.status === "healthy" || data.status === "degraded",
        modules: {
          gateway: data.modules?.gateway?.active ?? false,
          tools: data.modules?.tools?.registered ?? 0,
          skills: data.modules?.skills?.loaded ?? 0,
          plugins: data.modules?.plugins?.loaded ?? 0,
          streaming: data.modules?.streaming?.active ?? false,
        },
        version: data.version || "unknown",
      }))
      .catch(() => setStatus(null));
  }, []);

  return status;
}
