import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  generateAriaId,
  getDropdownTriggerProps,
  getToggleButtonProps,
  getTabProps,
  getTabPanelProps,
  getImageProps,
  getLoadingProps,
  getErrorProps,
  getInputProps,
  getDialogProps,
  getProgressProps,
  KeyboardKeys,
  isActivationKey,
  isNavigationKey,
  srOnlyStyle,
  SR_ONLY_CLASS,
  announceToScreenReader,
  focusFirstFocusable,
  trapFocus,
} from "./accessibility-utils";

describe("generateAriaId", () => {
  it("generates unique IDs", () => {
    const id1 = generateAriaId("test");
    const id2 = generateAriaId("test");
    expect(id1).not.toBe(id2);
  });

  it("uses prefix", () => {
    const id = generateAriaId("custom");
    expect(id).toMatch(/^custom-/);
  });

  it("uses default prefix", () => {
    const id = generateAriaId();
    expect(id).toMatch(/^aria-/);
  });
});

describe("getDropdownTriggerProps", () => {
  it("returns correct props when open", () => {
    const props = getDropdownTriggerProps(true, "menu-1");
    expect(props["aria-haspopup"]).toBe("menu");
    expect(props["aria-expanded"]).toBe(true);
    expect(props["aria-controls"]).toBe("menu-1");
  });

  it("returns correct props when closed", () => {
    const props = getDropdownTriggerProps(false);
    expect(props["aria-expanded"]).toBe(false);
    expect(props["aria-controls"]).toBeUndefined();
  });

  it("supports different popup types", () => {
    const props = getDropdownTriggerProps(true, "lb-1", "listbox");
    expect(props["aria-haspopup"]).toBe("listbox");
  });
});

describe("getToggleButtonProps", () => {
  it("returns pressed state", () => {
    const props = getToggleButtonProps(true);
    expect(props["aria-pressed"]).toBe(true);
    expect(props.role).toBe("button");
  });

  it("returns not pressed state", () => {
    const props = getToggleButtonProps(false);
    expect(props["aria-pressed"]).toBe(false);
  });
});

describe("getTabProps", () => {
  it("returns selected tab props", () => {
    const props = getTabProps(true, "panel-1");
    expect(props.role).toBe("tab");
    expect(props["aria-selected"]).toBe(true);
    expect(props["aria-controls"]).toBe("panel-1");
    expect(props.tabIndex).toBe(0);
  });

  it("returns unselected tab props", () => {
    const props = getTabProps(false, "panel-1");
    expect(props["aria-selected"]).toBe(false);
    expect(props.tabIndex).toBe(-1);
  });
});

describe("getTabPanelProps", () => {
  it("returns active panel props", () => {
    const props = getTabPanelProps("tab-1", true);
    expect(props.role).toBe("tabpanel");
    expect(props["aria-labelledby"]).toBe("tab-1");
    expect(props.hidden).toBe(false);
  });

  it("returns inactive panel props", () => {
    const props = getTabPanelProps("tab-1", false);
    expect(props.hidden).toBe(true);
  });
});

describe("getImageProps", () => {
  it("returns alt text for content images", () => {
    const props = getImageProps("A cute cat");
    expect(props.alt).toBe("A cute cat");
    expect(props.role).toBeUndefined();
  });

  it("returns presentation role for decorative images", () => {
    const props = getImageProps("", true);
    expect(props.alt).toBe("");
    expect(props.role).toBe("presentation");
  });
});

describe("getLoadingProps", () => {
  it("returns loading props", () => {
    const props = getLoadingProps(true);
    expect(props["aria-busy"]).toBe(true);
    expect(props["aria-live"]).toBe("polite");
    expect(props.role).toBe("status");
  });

  it("returns urgent loading props", () => {
    const props = getLoadingProps(true, true);
    expect(props["aria-live"]).toBe("assertive");
  });

  it("returns not loading props", () => {
    const props = getLoadingProps(false);
    expect(props["aria-busy"]).toBe(false);
  });
});

describe("getErrorProps", () => {
  it("returns error announcement props", () => {
    const props = getErrorProps();
    expect(props.role).toBe("alert");
    expect(props["aria-live"]).toBe("assertive");
  });
});

describe("getInputProps", () => {
  it("returns error props when has error", () => {
    const props = getInputProps({ hasError: true, errorId: "err-1" });
    expect(props["aria-invalid"]).toBe(true);
    expect(props["aria-describedby"]).toBe("err-1");
  });

  it("returns required props", () => {
    const props = getInputProps({ isRequired: true });
    expect(props["aria-required"]).toBe(true);
  });

  it("combines error and help text in describedby", () => {
    const props = getInputProps({ hasError: true, errorId: "err", helpTextId: "help" });
    expect(props["aria-describedby"]).toBe("err help");
  });

  it("returns empty props with no options", () => {
    const props = getInputProps({});
    expect(props["aria-invalid"]).toBeUndefined();
    expect(props["aria-required"]).toBeUndefined();
    expect(props["aria-describedby"]).toBeUndefined();
  });
});

describe("getDialogProps", () => {
  it("returns dialog props", () => {
    const props = getDialogProps({ titleId: "title-1" });
    expect(props.role).toBe("dialog");
    expect(props["aria-modal"]).toBe(true);
    expect(props["aria-labelledby"]).toBe("title-1");
  });

  it("returns alertdialog props", () => {
    const props = getDialogProps({ titleId: "title-1", isAlert: true });
    expect(props.role).toBe("alertdialog");
  });

  it("includes description ID when provided", () => {
    const props = getDialogProps({ titleId: "t", descriptionId: "d" });
    expect(props["aria-describedby"]).toBe("d");
  });
});

describe("getProgressProps", () => {
  it("returns progressbar props", () => {
    const props = getProgressProps({ value: 50, label: "Upload progress" });
    expect(props.role).toBe("progressbar");
    expect(props["aria-valuenow"]).toBe(50);
    expect(props["aria-valuemin"]).toBe(0);
    expect(props["aria-valuemax"]).toBe(100);
    expect(props["aria-label"]).toBe("Upload progress");
  });

  it("supports custom max", () => {
    const props = getProgressProps({ value: 5, max: 10, label: "Steps" });
    expect(props["aria-valuemax"]).toBe(10);
  });

  it("includes valueText when provided", () => {
    const props = getProgressProps({ value: 75, label: "Loading", valueText: "75 percent" });
    expect(props["aria-valuetext"]).toBe("75 percent");
  });
});

describe("KeyboardKeys", () => {
  it("has all expected keys", () => {
    expect(KeyboardKeys.ENTER).toBe("Enter");
    expect(KeyboardKeys.SPACE).toBe(" ");
    expect(KeyboardKeys.ESCAPE).toBe("Escape");
    expect(KeyboardKeys.TAB).toBe("Tab");
    expect(KeyboardKeys.ARROW_UP).toBe("ArrowUp");
    expect(KeyboardKeys.ARROW_DOWN).toBe("ArrowDown");
  });
});

describe("isActivationKey", () => {
  it("returns true for Enter and Space", () => {
    expect(isActivationKey("Enter")).toBe(true);
    expect(isActivationKey(" ")).toBe(true);
  });

  it("returns false for other keys", () => {
    expect(isActivationKey("Tab")).toBe(false);
    expect(isActivationKey("a")).toBe(false);
  });
});

describe("isNavigationKey", () => {
  it("returns true for arrow keys", () => {
    expect(isNavigationKey("ArrowUp")).toBe(true);
    expect(isNavigationKey("ArrowDown")).toBe(true);
    expect(isNavigationKey("ArrowLeft")).toBe(true);
    expect(isNavigationKey("ArrowRight")).toBe(true);
  });

  it("returns true for Home and End", () => {
    expect(isNavigationKey("Home")).toBe(true);
    expect(isNavigationKey("End")).toBe(true);
  });

  it("returns false for non-nav keys", () => {
    expect(isNavigationKey("Enter")).toBe(false);
    expect(isNavigationKey("a")).toBe(false);
  });
});

describe("srOnlyStyle", () => {
  it("has correct styles for screen reader only", () => {
    expect(srOnlyStyle.position).toBe("absolute");
    expect(srOnlyStyle.width).toBe("1px");
    expect(srOnlyStyle.height).toBe("1px");
    expect(srOnlyStyle.overflow).toBe("hidden");
  });
});

describe("SR_ONLY_CLASS", () => {
  it("is sr-only", () => {
    expect(SR_ONLY_CLASS).toBe("sr-only");
  });
});

describe("announceToScreenReader", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("creates and removes announcement element", async () => {
    vi.useFakeTimers();
    announceToScreenReader("Test message");
    const elements = document.querySelectorAll('[role="status"]');
    expect(elements.length).toBe(1);
    expect(elements[0].textContent).toBe("Test message");

    vi.advanceTimersByTime(1100);
    expect(document.querySelectorAll('[role="status"]').length).toBe(0);
    vi.useRealTimers();
  });

  it("sets assertive priority when urgent", () => {
    vi.useFakeTimers();
    announceToScreenReader("Urgent!", "assertive");
    const el = document.querySelector('[role="status"]');
    expect(el?.getAttribute("aria-live")).toBe("assertive");
    vi.advanceTimersByTime(1100);
    vi.useRealTimers();
  });
});

describe("focusFirstFocusable", () => {
  it("focuses first focusable element", () => {
    document.body.innerHTML = '<div id="container"><button id="btn1">Click</button><button id="btn2">Click2</button></div>';
    const container = document.getElementById("container")!;
    focusFirstFocusable(container);
    expect(document.activeElement?.id).toBe("btn1");
  });

  it("does nothing when no focusable elements", () => {
    document.body.innerHTML = '<div id="container"><span>Text</span></div>';
    const container = document.getElementById("container")!;
    focusFirstFocusable(container); // should not throw
  });
});

describe("trapFocus", () => {
  it("returns cleanup function", () => {
    document.body.innerHTML = '<div id="container"><button>A</button><button>B</button></div>';
    const container = document.getElementById("container")!;
    const cleanup = trapFocus(container);
    expect(typeof cleanup).toBe("function");
    cleanup();
  });
});
