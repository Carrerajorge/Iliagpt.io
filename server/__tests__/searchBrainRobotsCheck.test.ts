/**
 * Tests for the robots.txt evaluator.
 * All fetches are injected; no real network.
 */

import { describe, expect, it, vi } from "vitest";
import {
  checkRobots,
  ROBOTS_INTERNAL,
  parseRobots,
  isPathAllowed,
  pathMatches,
} from "../services/searchBrain/robotsCheck";

describe("pathMatches", () => {
  it("literal prefix", () => {
    expect(pathMatches("/results/page", "/results")).toBe(true);
    expect(pathMatches("/other", "/results")).toBe(false);
  });

  it("wildcard", () => {
    expect(pathMatches("/search?q=foo", "/search*q=")).toBe(true);
    expect(pathMatches("/search?ok=foo", "/search*q=")).toBe(false);
  });

  it("end anchor", () => {
    expect(pathMatches("/exact", "/exact$")).toBe(true);
    expect(pathMatches("/exact/more", "/exact$")).toBe(false);
  });

  it("empty rule never matches", () => {
    expect(pathMatches("/any", "")).toBe(false);
  });
});

describe("parseRobots + isPathAllowed", () => {
  it("selects the user-agent-specific group when matching", () => {
    const body = `
      User-agent: *
      Disallow: /
      User-agent: IliaGPT
      Allow: /api/
      Disallow: /private/
    `;
    const rules = parseRobots(body, "IliaGPT-SearchBrain/1.0 (+https://iliagpt.io)");
    expect(rules.matched).toBeTruthy();
    expect(isPathAllowed(rules, "/api/search").allowed).toBe(true);
    expect(isPathAllowed(rules, "/private/x").allowed).toBe(false);
    // Wildcard group still exists but is overridden by the matching group.
    expect(rules.wildcardFallback).toBeTruthy();
  });

  it("falls back to * group when no UA-specific group", () => {
    const body = `
      User-agent: *
      Disallow: /results/
    `;
    const rules = parseRobots(body, "Unknown/1.0");
    expect(rules.matched).toBeNull();
    expect(isPathAllowed(rules, "/results/foo").allowed).toBe(false);
    expect(isPathAllowed(rules, "/allowed").allowed).toBe(true);
  });

  it("longest-match wins; Allow wins on ties", () => {
    const body = `
      User-agent: *
      Allow: /results/special
      Disallow: /results/
    `;
    const rules = parseRobots(body, "Any");
    expect(isPathAllowed(rules, "/results/special/paper").allowed).toBe(true);
    expect(isPathAllowed(rules, "/results/other").allowed).toBe(false);
  });

  it("empty body → allowed (no rules)", () => {
    const rules = parseRobots("", "Any");
    expect(isPathAllowed(rules, "/anything").allowed).toBe(true);
  });
});

describe("checkRobots", () => {
  it("returns disallowed when robots.txt is unreachable", async () => {
    const fetcher = vi.fn(async () => null);
    const r = await checkRobots({
      targetUrl: "https://example.com/results/foo",
      fetcher,
    });
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/unreachable/);
  });

  it("returns allowed when robots.txt has no matching rule", async () => {
    const fetcher = vi.fn(async () => "User-agent: *\nAllow: /");
    const r = await checkRobots({
      targetUrl: "https://example.com/results/foo",
      fetcher,
    });
    expect(r.allowed).toBe(true);
  });

  it("enforces Disallow for our User-Agent group", async () => {
    const body = "User-agent: IliaGPT\nDisallow: /results/";
    const fetcher = vi.fn(async () => body);
    const r = await checkRobots({
      targetUrl: "https://example.com/results/paper",
      userAgent: "IliaGPT-SearchBrain/1.0 (+https://iliagpt.io)",
      fetcher,
    });
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/disallowed by Disallow/i);
  });

  it("invalid target URL → disallowed", async () => {
    const r = await checkRobots({ targetUrl: "not a url", fetcher: async () => "" });
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/invalid target URL/);
  });
});

describe("ROBOTS_INTERNAL exports", () => {
  it("exposes the internals for advanced callers", () => {
    expect(ROBOTS_INTERNAL.parseRobots).toBe(parseRobots);
    expect(ROBOTS_INTERNAL.isPathAllowed).toBe(isPathAllowed);
    expect(ROBOTS_INTERNAL.pathMatches).toBe(pathMatches);
  });
});
