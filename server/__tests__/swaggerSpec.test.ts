import { describe, expect, it } from "vitest";

import { swaggerSpec } from "../lib/swagger";

describe("swaggerSpec", () => {
  it("publishes a valid OpenAPI document with chat and health paths", () => {
    expect(swaggerSpec.openapi).toBe("3.0.0");
    expect(swaggerSpec.info.title).toBe("ILIAGPT PRO API");
    expect(swaggerSpec.paths["/chat"]).toBeDefined();
    expect(swaggerSpec.paths["/chat/stream"]).toBeDefined();
    expect(swaggerSpec.paths["/health/live"]).toBeDefined();
    expect(swaggerSpec.components?.securitySchemes?.cookieAuth).toBeDefined();
  });
});
