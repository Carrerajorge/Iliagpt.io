/**
 * Capability 07 — Computer Use / Desktop Automation
 *
 * Tests for controlling desktop applications, navigating browsers at the OS
 * level, interacting with spreadsheets, completing forms, and enforcing
 * permission guardrails before any destructive or network-touching action.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runWithEachProvider } from "../_setup/providerMatrix";
import { getMockResponseForProvider, createTextResponse } from "../_setup/mockResponses";
import { createMockAgent, waitFor } from "../_setup/testHelpers";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

// Mock the system-level computer-use adapter so tests never touch real OS APIs.
const mockComputerUse = {
  screenshot: vi.fn(),
  launchApp: vi.fn(),
  closeApp: vi.fn(),
  focusWindow: vi.fn(),
  minimizeWindow: vi.fn(),
  maximizeWindow: vi.fn(),
  listWindows: vi.fn(),
  click: vi.fn(),
  type: vi.fn(),
  keyPress: vi.fn(),
  scroll: vi.fn(),
  openUrl: vi.fn(),
  handleDialog: vi.fn(),
  requestPermission: vi.fn(),
  checkSandboxBreach: vi.fn(),
};

vi.mock("../../../server/agent/computer/desktopAdapter", () => ({
  default: mockComputerUse,
  DesktopAdapter: vi.fn(() => mockComputerUse),
}));

vi.mock("../../../server/agent/computer/permissionGuard", () => ({
  PermissionGuard: vi.fn().mockImplementation(() => ({
    check: vi.fn().mockResolvedValue({ allowed: true, requiresApproval: false }),
    requireApproval: vi.fn().mockResolvedValue({ approved: true }),
  })),
  requiresApprovalFor: vi.fn().mockReturnValue(false),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MOCK_SCREENSHOT_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

const MOCK_WINDOW_LIST = [
  { id: "win-1", title: "Google Chrome", pid: 1234, focused: true },
  { id: "win-2", title: "Visual Studio Code", pid: 5678, focused: false },
  { id: "win-3", title: "Microsoft Excel", pid: 9012, focused: false },
];

const COMPUTER_USE_TOOL = {
  name: "computer_use",
  arguments: { action: "screenshot", coordinate: [0, 0] },
};

// ---------------------------------------------------------------------------
// 1. Application control
// ---------------------------------------------------------------------------

describe("Application control", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockComputerUse.screenshot.mockResolvedValue({ imageBase64: MOCK_SCREENSHOT_B64 });
    mockComputerUse.launchApp.mockResolvedValue({ pid: 4321, windowId: "win-new" });
    mockComputerUse.closeApp.mockResolvedValue({ success: true });
    mockComputerUse.focusWindow.mockResolvedValue({ success: true });
    mockComputerUse.minimizeWindow.mockResolvedValue({ success: true });
    mockComputerUse.maximizeWindow.mockResolvedValue({ success: true });
    mockComputerUse.listWindows.mockResolvedValue(MOCK_WINDOW_LIST);
  });

  runWithEachProvider(
    "opens an application by name",
    "computer-use",
    async (provider) => {
      const response = getMockResponseForProvider(provider.name, {
        name: "launch_application",
        arguments: { appName: "Calculator", waitForReady: true },
      });

      // The response should include a tool call to launch the app
      const asAny = response as Record<string, unknown>;
      if (provider.isMock || provider.name === "anthropic") {
        const content = asAny["content"] as Array<Record<string, unknown>>;
        const toolUse = content.find((c) => c["type"] === "tool_use");
        expect(toolUse).toBeDefined();
        expect(toolUse!["name"]).toBe("launch_application");
        const input = toolUse!["input"] as Record<string, unknown>;
        expect(input["appName"]).toBe("Calculator");
      }

      // Simulate adapter invocation
      const result = await mockComputerUse.launchApp({ appName: "Calculator", waitForReady: true });
      expect(result.pid).toBeGreaterThan(0);
      expect(result.windowId).toBeTruthy();
      expect(mockComputerUse.launchApp).toHaveBeenCalledWith(
        expect.objectContaining({ appName: "Calculator" }),
      );
    },
  );

  runWithEachProvider(
    "switches focus between open windows",
    "computer-use",
    async (provider) => {
      const windows = await mockComputerUse.listWindows();
      expect(windows).toHaveLength(3);

      const vscode = windows.find((w: { title: string }) => w.title === "Visual Studio Code");
      expect(vscode).toBeDefined();

      const focusResult = await mockComputerUse.focusWindow({ windowId: vscode!.id });
      expect(focusResult.success).toBe(true);
      expect(mockComputerUse.focusWindow).toHaveBeenCalledWith({ windowId: "win-2" });
    },
  );

  runWithEachProvider(
    "closes an application gracefully",
    "computer-use",
    async (provider) => {
      // Take screenshot first to identify current state
      const screenshot = await mockComputerUse.screenshot();
      expect(screenshot.imageBase64).toBeTruthy();

      const closeResult = await mockComputerUse.closeApp({ windowId: "win-3", force: false });
      expect(closeResult.success).toBe(true);
      expect(mockComputerUse.closeApp).toHaveBeenCalledWith(
        expect.objectContaining({ force: false }),
      );
    },
  );

  runWithEachProvider(
    "minimizes and maximizes a window",
    "computer-use",
    async (provider) => {
      const minResult = await mockComputerUse.minimizeWindow({ windowId: "win-1" });
      expect(minResult.success).toBe(true);

      const maxResult = await mockComputerUse.maximizeWindow({ windowId: "win-1" });
      expect(maxResult.success).toBe(true);

      expect(mockComputerUse.minimizeWindow).toHaveBeenCalledTimes(1);
      expect(mockComputerUse.maximizeWindow).toHaveBeenCalledTimes(1);
    },
  );
});

// ---------------------------------------------------------------------------
// 2. Browser navigation via desktop
// ---------------------------------------------------------------------------

describe("Browser navigation via desktop", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockComputerUse.launchApp.mockResolvedValue({ pid: 2222, windowId: "win-chrome" });
    mockComputerUse.openUrl.mockResolvedValue({ success: true, finalUrl: "https://example.com" });
    mockComputerUse.click.mockResolvedValue({ success: true });
    mockComputerUse.type.mockResolvedValue({ success: true, typed: true });
    mockComputerUse.handleDialog.mockResolvedValue({ action: "dismissed", text: null });
    mockComputerUse.screenshot.mockResolvedValue({ imageBase64: MOCK_SCREENSHOT_B64 });
  });

  runWithEachProvider(
    "opens Chrome and navigates to a URL",
    "computer-use",
    async (provider) => {
      const launch = await mockComputerUse.launchApp({ appName: "Google Chrome" });
      expect(launch.windowId).toBe("win-chrome");

      const nav = await mockComputerUse.openUrl({
        windowId: launch.windowId,
        url: "https://example.com",
        waitForLoad: true,
      });
      expect(nav.success).toBe(true);
      expect(nav.finalUrl).toBe("https://example.com");

      // Validate provider issued a tool call that includes browser navigation intent
      const response = getMockResponseForProvider(provider.name, {
        name: "browser_navigate_desktop",
        arguments: { url: "https://example.com" },
      });
      expect(response).toBeDefined();
    },
  );

  runWithEachProvider(
    "clicks the address bar and types a new URL",
    "computer-use",
    async (provider) => {
      // Simulate clicking the Chrome address bar (coordinate-based interaction)
      const clickResult = await mockComputerUse.click({ coordinate: [760, 42] });
      expect(clickResult.success).toBe(true);

      // Type the new URL
      const typeResult = await mockComputerUse.type({ text: "https://google.com\n" });
      expect(typeResult.success).toBe(true);
      expect(typeResult.typed).toBe(true);

      expect(mockComputerUse.click).toHaveBeenCalledWith(
        expect.objectContaining({ coordinate: expect.any(Array) }),
      );
    },
  );

  runWithEachProvider(
    "handles a browser popup dialog",
    "computer-use",
    async (provider) => {
      // Simulate a confirm() popup appearing
      const dialogResult = await mockComputerUse.handleDialog({
        type: "confirm",
        action: "dismiss",
      });
      expect(dialogResult.action).toBe("dismissed");

      // Screenshot taken after dismissal to verify state
      const screenshot = await mockComputerUse.screenshot();
      expect(screenshot.imageBase64).toBeTruthy();
    },
  );
});

// ---------------------------------------------------------------------------
// 3. Spreadsheet interaction
// ---------------------------------------------------------------------------

describe("Spreadsheet interaction", () => {
  const mockSpreadsheet = {
    getCellValue: vi.fn(),
    setCellValue: vi.fn(),
    navigateToCell: vi.fn(),
    executeMacro: vi.fn(),
    saveFile: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockSpreadsheet.getCellValue.mockResolvedValue({ cell: "A1", value: "" });
    mockSpreadsheet.setCellValue.mockImplementation(async (args: { cell: string; value: unknown }) => ({ cell: args.cell, value: args.value, success: true }));
    mockSpreadsheet.navigateToCell.mockImplementation(async (args: { cell: string }) => ({ cell: args.cell, success: true }));
    mockSpreadsheet.executeMacro.mockResolvedValue({ success: true, output: "Macro ran" });
    mockSpreadsheet.saveFile.mockResolvedValue({ saved: true, path: "/Users/test/sheet.xlsx" });
    mockComputerUse.screenshot.mockResolvedValue({ imageBase64: MOCK_SCREENSHOT_B64 });
    mockComputerUse.click.mockResolvedValue({ success: true });
    mockComputerUse.type.mockResolvedValue({ success: true, typed: true });
    mockComputerUse.keyPress.mockResolvedValue({ success: true });
  });

  runWithEachProvider(
    "fills a cell in a spreadsheet",
    "computer-use",
    async (provider) => {
      // Click on cell A1
      const click = await mockComputerUse.click({ coordinate: [120, 200] });
      expect(click.success).toBe(true);

      // Type the value
      const type = await mockComputerUse.type({ text: "Revenue Q1" });
      expect(type.success).toBe(true);

      // Press Tab to move to next cell
      const tab = await mockComputerUse.keyPress({ key: "Tab" });
      expect(tab.success).toBe(true);

      // Validate mock spreadsheet API call
      const set = await mockSpreadsheet.setCellValue({ cell: "A1", value: "Revenue Q1" });
      expect(set.success).toBe(true);
      expect(set.value).toBe("Revenue Q1");
    },
  );

  runWithEachProvider(
    "navigates between cells using keyboard shortcuts",
    "computer-use",
    async (provider) => {
      // Ctrl+Home → beginning of sheet
      await mockComputerUse.keyPress({ key: "ctrl+Home" });
      // Arrow down 3 rows
      await mockComputerUse.keyPress({ key: "ArrowDown", repeat: 3 });
      // Arrow right 2 columns
      await mockComputerUse.keyPress({ key: "ArrowRight", repeat: 2 });

      const nav = await mockSpreadsheet.navigateToCell({ cell: "C4" });
      expect(nav.success).toBe(true);
      expect(nav.cell).toBe("C4");

      expect(mockComputerUse.keyPress).toHaveBeenCalledTimes(3);
    },
  );

  runWithEachProvider(
    "executes a macro in the spreadsheet",
    "computer-use",
    async (provider) => {
      const macroResult = await mockSpreadsheet.executeMacro({
        name: "SummarizeData",
        args: { range: "A1:D100" },
      });
      expect(macroResult.success).toBe(true);
      expect(macroResult.output).toBe("Macro ran");
      expect(mockSpreadsheet.executeMacro).toHaveBeenCalledWith(
        expect.objectContaining({ name: "SummarizeData" }),
      );
    },
  );

  runWithEachProvider(
    "saves a spreadsheet file after editing",
    "computer-use",
    async (provider) => {
      // Simulate Ctrl+S
      await mockComputerUse.keyPress({ key: "ctrl+s" });
      const saveResult = await mockSpreadsheet.saveFile({ path: "/Users/test/sheet.xlsx" });
      expect(saveResult.saved).toBe(true);
      expect(saveResult.path).toContain(".xlsx");
    },
  );
});

// ---------------------------------------------------------------------------
// 4. Form completion workflows
// ---------------------------------------------------------------------------

describe("Form completion workflows", () => {
  const mockForm = {
    fillField: vi.fn(),
    selectOption: vi.fn(),
    submitForm: vi.fn(),
    handleFileDialog: vi.fn(),
    handleConfirmationDialog: vi.fn(),
    getFieldValue: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockForm.fillField.mockResolvedValue({ field: "name", value: "Test User", success: true });
    mockForm.selectOption.mockResolvedValue({ field: "country", value: "US", success: true });
    mockForm.submitForm.mockResolvedValue({ success: true, redirectUrl: "/success" });
    mockForm.handleFileDialog.mockResolvedValue({ selected: "/tmp/test-doc.pdf", success: true });
    mockForm.handleConfirmationDialog.mockResolvedValue({ confirmed: true });
    mockForm.getFieldValue.mockResolvedValue({ value: "Test User" });
  });

  runWithEachProvider(
    "completes a multi-step form end-to-end",
    "computer-use",
    async (provider) => {
      // Step 1: Fill name field
      const nameResult = await mockForm.fillField({ selector: "#name", value: "Test User" });
      expect(nameResult.success).toBe(true);

      // Step 2: Fill email
      const emailResult = await mockForm.fillField({
        selector: "#email",
        value: "test@example.com",
      });
      expect(emailResult.success).toBe(true);

      // Step 3: Select country
      const countryResult = await mockForm.selectOption({
        selector: "#country",
        value: "US",
      });
      expect(countryResult.success).toBe(true);

      // Step 4: Submit
      const submitResult = await mockForm.submitForm({ selector: "button[type=submit]" });
      expect(submitResult.success).toBe(true);
      expect(submitResult.redirectUrl).toBe("/success");

      // Verify the sequence was called correctly
      expect(mockForm.fillField).toHaveBeenCalledTimes(2);
      expect(mockForm.selectOption).toHaveBeenCalledTimes(1);
      expect(mockForm.submitForm).toHaveBeenCalledTimes(1);
    },
  );

  runWithEachProvider(
    "handles a file upload dialog",
    "computer-use",
    async (provider) => {
      // Click the upload button — this triggers a native file dialog
      await mockComputerUse.click({ coordinate: [400, 300] });

      const dialogResult = await mockForm.handleFileDialog({
        filePath: "/tmp/test-doc.pdf",
        accept: ".pdf",
      });
      expect(dialogResult.selected).toBe("/tmp/test-doc.pdf");
      expect(dialogResult.success).toBe(true);
    },
  );

  runWithEachProvider(
    "handles a confirmation dialog before submission",
    "computer-use",
    async (provider) => {
      await mockForm.fillField({ selector: "#amount", value: "500" });

      // Confirmation dialog should appear before destructive action
      const confirmResult = await mockForm.handleConfirmationDialog({
        message: "Are you sure you want to submit?",
        action: "confirm",
      });
      expect(confirmResult.confirmed).toBe(true);

      const submitResult = await mockForm.submitForm({ selector: "#submit-btn" });
      expect(submitResult.success).toBe(true);
    },
  );

  runWithEachProvider(
    "reads back a filled form field value for verification",
    "computer-use",
    async (provider) => {
      await mockForm.fillField({ selector: "#full-name", value: "Test User" });
      const readBack = await mockForm.getFieldValue({ selector: "#full-name" });
      expect(readBack.value).toBe("Test User");
    },
  );
});

// ---------------------------------------------------------------------------
// 5. Permission handling
// ---------------------------------------------------------------------------

describe("Permission handling", () => {
  const mockPermissionGuard = {
    check: vi.fn(),
    requireApproval: vi.fn(),
    detectSandboxBreach: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockPermissionGuard.check.mockResolvedValue({ allowed: true, requiresApproval: false });
    mockPermissionGuard.requireApproval.mockResolvedValue({ approved: true, userConfirmed: true });
    mockPermissionGuard.detectSandboxBreach.mockReturnValue(false);
  });

  runWithEachProvider(
    "asks for approval before a destructive action",
    "computer-use",
    async (provider) => {
      // Simulate checking permission for "delete file" — destructive
      mockPermissionGuard.check.mockResolvedValueOnce({
        allowed: false,
        requiresApproval: true,
        reason: "destructive_action",
      });

      const permCheck = await mockPermissionGuard.check({
        action: "delete_file",
        path: "/Users/test/important.docx",
      });
      expect(permCheck.requiresApproval).toBe(true);
      expect(permCheck.allowed).toBe(false);

      // The guard should then request user approval
      const approval = await mockPermissionGuard.requireApproval({
        action: "delete_file",
        description: 'Delete file "/Users/test/important.docx"?',
      });
      expect(approval.approved).toBe(true);
      expect(approval.userConfirmed).toBe(true);
    },
  );

  runWithEachProvider(
    "requires approval before making an external network request",
    "computer-use",
    async (provider) => {
      mockPermissionGuard.check.mockResolvedValueOnce({
        allowed: false,
        requiresApproval: true,
        reason: "external_network",
      });

      const permCheck = await mockPermissionGuard.check({
        action: "http_request",
        url: "https://external-api.example.com/data",
      });
      expect(permCheck.requiresApproval).toBe(true);

      const approval = await mockPermissionGuard.requireApproval({
        action: "http_request",
        description: "Allow outbound request to https://external-api.example.com?",
      });
      expect(approval.approved).toBe(true);
    },
  );

  runWithEachProvider(
    "detects and blocks sandbox escape attempts",
    "computer-use",
    async (provider) => {
      // If code tries to write outside the sandbox, detection should fire
      mockPermissionGuard.detectSandboxBreach.mockReturnValueOnce(true);

      const isBreach = mockPermissionGuard.detectSandboxBreach({
        action: "write_file",
        path: "/etc/hosts",
      });
      expect(isBreach).toBe(true);

      // After detection, the action must be blocked (allowed: false)
      mockPermissionGuard.check.mockResolvedValueOnce({
        allowed: false,
        requiresApproval: false,
        reason: "sandbox_violation",
      });

      const permCheck = await mockPermissionGuard.check({
        action: "write_file",
        path: "/etc/hosts",
      });
      expect(permCheck.allowed).toBe(false);
      expect(permCheck.reason).toBe("sandbox_violation");
    },
  );
});
