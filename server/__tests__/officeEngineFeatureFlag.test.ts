import { afterEach, describe, expect, it } from "vitest";
import { isOfficeEngineEnabled } from "../lib/office/featureFlag";

describe("isOfficeEngineEnabled", () => {
  const originalValue = process.env.FEATURE_OFFICE_ENGINE;

  afterEach(() => {
    if (typeof originalValue === "string") {
      process.env.FEATURE_OFFICE_ENGINE = originalValue;
    } else {
      delete process.env.FEATURE_OFFICE_ENGINE;
    }
  });

  it("defaults to enabled when the flag is missing", () => {
    delete process.env.FEATURE_OFFICE_ENGINE;
    expect(isOfficeEngineEnabled()).toBe(true);
  });

  it("enables the office engine for explicit truthy values", () => {
    process.env.FEATURE_OFFICE_ENGINE = "1";
    expect(isOfficeEngineEnabled()).toBe(true);

    process.env.FEATURE_OFFICE_ENGINE = "true";
    expect(isOfficeEngineEnabled()).toBe(true);
  });

  it("disables the office engine only for explicit false values", () => {
    process.env.FEATURE_OFFICE_ENGINE = "0";
    expect(isOfficeEngineEnabled()).toBe(false);

    process.env.FEATURE_OFFICE_ENGINE = "false";
    expect(isOfficeEngineEnabled()).toBe(false);
  });

  it("fails open for malformed values to keep chat and HTTP surfaces aligned", () => {
    process.env.FEATURE_OFFICE_ENGINE = "maybe";
    expect(isOfficeEngineEnabled()).toBe(true);
  });
});
