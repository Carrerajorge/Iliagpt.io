import { describe, expect, it } from "vitest";
import vm from "node:vm";

import { buildOpenClawPreSeedScript } from "../openclawControlUi";

function createLocalStorage(seed: Record<string, string> = {}) {
  const data = new Map(Object.entries(seed));
  const storage: Record<string, unknown> = {};

  Object.defineProperties(storage, {
    getItem: {
      enumerable: false,
      value(key: string) {
        return data.has(key) ? data.get(key)! : null;
      },
    },
    setItem: {
      enumerable: false,
      value(key: string, value: string) {
        data.set(key, value);
        storage[key] = value;
      },
    },
    removeItem: {
      enumerable: false,
      value(key: string) {
        data.delete(key);
        delete storage[key];
      },
    },
  });

  for (const [key, value] of data.entries()) {
    storage[key] = value;
  }

  return { storage, data };
}

describe("buildOpenClawPreSeedScript", () => {
  it("seeds the control-ui gateway settings with a normalized /openclaw-ws key", () => {
    const script = buildOpenClawPreSeedScript({ safeToken: "token-123" });
    expect(script).toContain('replace(/\\/+$/,"")');

    const { storage, data } = createLocalStorage();
    const location = {
      protocol: "http:",
      host: "127.0.0.1:41731",
      href: "http://127.0.0.1:41731/openclaw-ui",
    };

    const context = vm.createContext({
      URL,
      console,
      localStorage: storage,
      location,
      window: { location },
    });

    expect(() => vm.runInContext(script, context)).not.toThrow();

    const settingsKey = "openclaw.control.settings.v1:ws://127.0.0.1:41731/openclaw-ws";
    const settingsDefaultKey = "openclaw.control.settings.v1:default";
    const tokenKey = "openclaw.control.token.v1:ws://127.0.0.1:41731/openclaw-ws";

    expect(data.get(settingsKey)).toBeTruthy();
    expect(data.get(settingsDefaultKey)).toBeTruthy();
    expect(data.get(tokenKey)).toBe("token-123");

    const parsed = JSON.parse(data.get(settingsKey)!);
    expect(parsed.gatewayUrl).toBe("ws://127.0.0.1:41731/openclaw-ws");
    expect(parsed.autoConnect).toBe(true);
    expect(parsed.sessionKey).toBe("main");
  });
});
