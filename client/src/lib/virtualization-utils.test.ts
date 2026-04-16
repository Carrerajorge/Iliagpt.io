import { describe, it, expect } from "vitest";
import {
  createStableItemRenderer,
  RenderCache,
  calculateVisibleRange,
  getItemsToRender,
} from "./virtualization-utils";

describe("createStableItemRenderer", () => {
  it("caches rendered items by key", () => {
    let callCount = 0;
    const renderer = createStableItemRenderer(
      (item: string, index: number) => {
        callCount++;
        return `rendered-${item}`;
      },
      (item: string) => item
    );

    const result1 = renderer("a", 0);
    const result2 = renderer("a", 0);
    expect(result1).toBe("rendered-a");
    expect(result2).toBe("rendered-a");
    expect(callCount).toBe(1); // cached
  });

  it("creates different entries for different keys", () => {
    let callCount = 0;
    const renderer = createStableItemRenderer(
      (item: string) => {
        callCount++;
        return item;
      },
      (item: string) => item
    );

    renderer("a", 0);
    renderer("b", 1);
    expect(callCount).toBe(2);
  });
});

describe("RenderCache", () => {
  it("stores and retrieves items", () => {
    const cache = new RenderCache<string>(10);
    cache.set("key1", "value1");
    expect(cache.get("key1")).toBe("value1");
  });

  it("returns undefined for missing keys", () => {
    const cache = new RenderCache<string>(10);
    expect(cache.get("missing")).toBeUndefined();
  });

  it("evicts oldest items when at capacity", () => {
    const cache = new RenderCache<string>(3);
    cache.set("a", "1");
    cache.set("b", "2");
    cache.set("c", "3");
    cache.set("d", "4"); // should evict "a"
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("d")).toBe("4");
    expect(cache.size()).toBe(3);
  });

  it("updates existing item without eviction", () => {
    const cache = new RenderCache<string>(3);
    cache.set("a", "1");
    cache.set("b", "2");
    cache.set("c", "3");
    cache.set("a", "updated"); // update, not new
    expect(cache.get("a")).toBe("updated");
    expect(cache.size()).toBe(3);
  });

  it("moves accessed items to end (LRU)", () => {
    const cache = new RenderCache<string>(3);
    cache.set("a", "1");
    cache.set("b", "2");
    cache.set("c", "3");
    cache.get("a"); // access "a", making "b" the oldest
    cache.set("d", "4"); // should evict "b"
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe("1");
  });

  it("clears all items", () => {
    const cache = new RenderCache<string>(10);
    cache.set("a", "1");
    cache.set("b", "2");
    cache.clear();
    expect(cache.size()).toBe(0);
    expect(cache.get("a")).toBeUndefined();
  });

  it("reports correct size", () => {
    const cache = new RenderCache<number>(10);
    expect(cache.size()).toBe(0);
    cache.set("a", 1);
    cache.set("b", 2);
    expect(cache.size()).toBe(2);
  });
});

describe("calculateVisibleRange", () => {
  it("calculates correct range for top of list", () => {
    const result = calculateVisibleRange(0, 500, 50, 100, 3);
    expect(result.visibleStartIndex).toBe(0);
    expect(result.startIndex).toBe(0);
    expect(result.visibleEndIndex).toBe(10);
    expect(result.endIndex).toBe(13);
  });

  it("calculates correct range for scrolled position", () => {
    const result = calculateVisibleRange(500, 500, 50, 100, 3);
    expect(result.visibleStartIndex).toBe(10);
    expect(result.startIndex).toBe(7);
    expect(result.visibleEndIndex).toBe(20);
    expect(result.endIndex).toBe(23);
  });

  it("clamps to valid indices", () => {
    const result = calculateVisibleRange(4800, 500, 50, 100, 5);
    expect(result.startIndex).toBeGreaterThanOrEqual(0);
    expect(result.endIndex).toBeLessThan(100);
  });

  it("handles empty list", () => {
    const result = calculateVisibleRange(0, 500, 50, 0, 3);
    expect(result.startIndex).toBe(0);
    expect(result.endIndex).toBe(-1);
  });

  it("handles single item", () => {
    const result = calculateVisibleRange(0, 500, 50, 1, 3);
    expect(result.startIndex).toBe(0);
    expect(result.endIndex).toBe(0);
  });

  it("defaults overscan to 3", () => {
    const result = calculateVisibleRange(0, 500, 50, 100);
    expect(result.startIndex).toBe(0);
    expect(result.endIndex).toBe(13);
  });
});

describe("getItemsToRender", () => {
  it("returns items in range", () => {
    const items = ["a", "b", "c", "d", "e"];
    const result = getItemsToRender(items, 1, 3);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ item: "b", index: 1 });
    expect(result[2]).toEqual({ item: "d", index: 3 });
  });

  it("clamps to items length", () => {
    const items = ["a", "b", "c"];
    const result = getItemsToRender(items, 0, 10);
    expect(result).toHaveLength(3);
  });

  it("returns empty for out-of-bounds range", () => {
    const items = ["a", "b"];
    const result = getItemsToRender(items, 5, 10);
    expect(result).toHaveLength(0);
  });

  it("returns empty for empty items", () => {
    const result = getItemsToRender([], 0, 5);
    expect(result).toHaveLength(0);
  });
});
