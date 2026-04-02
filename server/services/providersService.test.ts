import { beforeEach, describe, expect, it, vi } from "vitest";

const { dbSelectMock } = vi.hoisted(() => ({
  dbSelectMock: vi.fn(),
}));

vi.mock("../db", () => ({
  db: {
    select: (...args: unknown[]) => dbSelectMock(...args),
  },
}));

import { providersService } from "./providersService";

function makeRejectingSelect(error: unknown) {
  return {
    from() {
      return {
        where() {
          return {
            limit() {
              return Promise.reject(error);
            },
            then(onFulfilled?: ((value: never) => unknown) | null, onRejected?: ((reason: unknown) => unknown) | null) {
              return Promise.reject(error).then(onFulfilled as any, onRejected as any);
            },
            catch(onRejected?: ((reason: unknown) => unknown) | null) {
              return Promise.reject(error).catch(onRejected as any);
            },
            finally(onFinally?: (() => void) | null) {
              return Promise.reject(error).finally(onFinally as any);
            },
          };
        },
      };
    },
  };
}

describe("providersService", () => {
  beforeEach(() => {
    dbSelectMock.mockReset();
  });

  it("treats missing OAuth token tables as disconnected instead of throwing", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const missingTableError = Object.assign(new Error('relation "oauth_tokens_global" does not exist'), {
      code: "42P01",
    });

    dbSelectMock.mockImplementation(() => makeRejectingSelect(missingTableError));

    await expect(providersService.getGlobalTokenStatus("openai")).resolves.toEqual({
      connected: false,
      label: null,
    });
    await expect(providersService.getUserTokenStatus("user_1", "openai")).resolves.toEqual({
      connected: false,
    });
    await expect(providersService.resolveToken("user_1", "openai")).resolves.toBeNull();
    await expect(providersService.getExpiringTokens()).resolves.toEqual({
      globalTokens: [],
      userTokens: [],
    });

    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
