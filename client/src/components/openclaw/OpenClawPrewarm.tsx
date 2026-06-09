import { useEffect } from "react";

/**
 * Prefetches the OpenClaw control UI so opening /openclaw feels instant.
 * Uses <link rel="prefetch"> — zero DOM interference, no iframe, no event-stealing.
 */
export function OpenClawPrewarm() {
  useEffect(() => {
    const schedule = (window as any).requestIdleCallback || ((cb: any) => setTimeout(cb, 1500));
    const handle = schedule(() => {
      const urls = ["/openclaw-ui", "/openclaw-ui/chat?session=main"];
      for (const href of urls) {
        if (document.head.querySelector(`link[rel="prefetch"][href="${href}"]`)) continue;
        const link = document.createElement("link");
        link.rel = "prefetch";
        link.href = href;
        link.as = "document";
        document.head.appendChild(link);
      }
    });
    return () => {
      const cancel = (window as any).cancelIdleCallback || clearTimeout;
      try { cancel(handle); } catch {}
    };
  }, []);

  return null;
}
