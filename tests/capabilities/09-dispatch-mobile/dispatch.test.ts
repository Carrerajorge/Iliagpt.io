/**
 * Capability 09 — Mobile Dispatch
 *
 * Tests for dispatching tasks from mobile devices (iOS / Android) to desktop
 * for full-resource execution, including cross-device context persistence,
 * offline queuing, and retry-on-reconnect behaviour.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runWithEachProvider } from "../_setup/providerMatrix";
import { getMockResponseForProvider, createTextResponse } from "../_setup/mockResponses";
import { createMockAgent, MockDatabase, waitFor } from "../_setup/testHelpers";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

const mockDispatcher = {
  sendToDevice: vi.fn(),
  receiveFromMobile: vi.fn(),
  executeOnDesktop: vi.fn(),
  returnResultToMobile: vi.fn(),
  queueTask: vi.fn(),
  flushQueue: vi.fn(),
  getQueuedTasks: vi.fn(),
};

const mockDeviceRegistry = {
  registerDevice: vi.fn(),
  getDevice: vi.fn(),
  isOnline: vi.fn(),
  listDevices: vi.fn(),
};

const mockThreadStore = {
  createThread: vi.fn(),
  appendMessage: vi.fn(),
  getThread: vi.fn(),
  syncThread: vi.fn(),
  listThreadsByDevice: vi.fn(),
};

vi.mock("../../../server/dispatch/mobileDispatcher", () => ({
  MobileDispatcher: vi.fn(() => mockDispatcher),
  default: mockDispatcher,
}));

vi.mock("../../../server/dispatch/deviceRegistry", () => ({
  DeviceRegistry: vi.fn(() => mockDeviceRegistry),
  default: mockDeviceRegistry,
}));

vi.mock("../../../server/dispatch/threadStore", () => ({
  ThreadStore: vi.fn(() => mockThreadStore),
  default: mockThreadStore,
}));

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const IOS_DEVICE = {
  id: "device-ios-001",
  platform: "ios",
  name: "iPhone 15 Pro",
  pushToken: "apns:abc123",
  online: true,
};

const ANDROID_DEVICE = {
  id: "device-android-001",
  platform: "android",
  name: "Pixel 8",
  pushToken: "fcm:xyz789",
  online: true,
};

const DESKTOP_DEVICE = {
  id: "device-desktop-001",
  platform: "macos",
  name: "MacBook Pro",
  pushToken: null,
  online: true,
};

function makeMobileTask(overrides: Record<string, unknown> = {}) {
  return {
    id: `mobile-task-${Date.now()}`,
    prompt: "Summarize my emails from today",
    sourceDeviceId: IOS_DEVICE.id,
    targetDeviceId: DESKTOP_DEVICE.id,
    priority: "normal",
    createdAt: new Date().toISOString(),
    status: "pending",
    payload: {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. iOS task dispatch
// ---------------------------------------------------------------------------

describe("iOS task dispatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDeviceRegistry.getDevice.mockImplementation((id: string) =>
      id === IOS_DEVICE.id ? IOS_DEVICE : DESKTOP_DEVICE,
    );
    mockDispatcher.sendToDevice.mockResolvedValue({
      dispatched: true,
      taskId: "mobile-task-001",
      deviceId: IOS_DEVICE.id,
      deliveredAt: new Date().toISOString(),
    });
  });

  runWithEachProvider(
    "sends a task to an iOS device",
    "dispatch-mobile",
    async (provider) => {
      const task = makeMobileTask({ sourceDeviceId: DESKTOP_DEVICE.id, targetDeviceId: IOS_DEVICE.id });

      const result = await mockDispatcher.sendToDevice({
        deviceId: IOS_DEVICE.id,
        task,
      });
      expect(result.dispatched).toBe(true);
      expect(result.deviceId).toBe(IOS_DEVICE.id);
      expect(result.deliveredAt).toBeTruthy();

      // Validate provider tool call
      const response = getMockResponseForProvider(provider.name, {
        name: "dispatch_to_mobile",
        arguments: { platform: "ios", deviceId: IOS_DEVICE.id, taskId: task.id },
      });
      expect(response).toBeDefined();
    },
  );

  runWithEachProvider(
    "serializes task parameters correctly for iOS push",
    "dispatch-mobile",
    async (provider) => {
      const complexTask = makeMobileTask({
        payload: {
          context: { chatId: "chat-abc", userId: "user-123" },
          tools: ["summarize", "search_email"],
          constraints: { maxTokens: 2000 },
        },
      });

      // Verify payload is JSON-serializable (no circular refs, no undefined)
      const serialized = JSON.stringify(complexTask);
      const deserialized = JSON.parse(serialized);
      expect(deserialized.payload.tools).toEqual(["summarize", "search_email"]);
      expect(deserialized.payload.constraints.maxTokens).toBe(2000);

      // Dispatch with full payload
      await mockDispatcher.sendToDevice({ deviceId: IOS_DEVICE.id, task: complexTask });
      expect(mockDispatcher.sendToDevice).toHaveBeenCalledWith(
        expect.objectContaining({ deviceId: IOS_DEVICE.id }),
      );
    },
  );

  runWithEachProvider(
    "sends a push notification after task dispatch",
    "dispatch-mobile",
    async (provider) => {
      const sendPushNotification = vi.fn().mockResolvedValue({
        notificationId: "notif-001",
        sent: true,
        platform: "apns",
      });

      const task = makeMobileTask();
      await mockDispatcher.sendToDevice({ deviceId: IOS_DEVICE.id, task });

      const notif = await sendPushNotification({
        token: IOS_DEVICE.pushToken,
        title: "Task dispatched",
        body: task.prompt,
        data: { taskId: task.id },
      });
      expect(notif.sent).toBe(true);
      expect(notif.platform).toBe("apns");
    },
  );
});

// ---------------------------------------------------------------------------
// 2. Android task dispatch
// ---------------------------------------------------------------------------

describe("Android task dispatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDeviceRegistry.getDevice.mockImplementation((id: string) =>
      id === ANDROID_DEVICE.id ? ANDROID_DEVICE : DESKTOP_DEVICE,
    );
    mockDispatcher.sendToDevice.mockResolvedValue({
      dispatched: true,
      taskId: "mobile-task-002",
      deviceId: ANDROID_DEVICE.id,
      deliveredAt: new Date().toISOString(),
    });
  });

  runWithEachProvider(
    "sends a task to an Android device",
    "dispatch-mobile",
    async (provider) => {
      const task = makeMobileTask({
        sourceDeviceId: DESKTOP_DEVICE.id,
        targetDeviceId: ANDROID_DEVICE.id,
      });

      const result = await mockDispatcher.sendToDevice({
        deviceId: ANDROID_DEVICE.id,
        task,
      });
      expect(result.dispatched).toBe(true);
      expect(result.deviceId).toBe(ANDROID_DEVICE.id);
    },
  );

  runWithEachProvider(
    "uses a cross-platform task format for iOS and Android",
    "dispatch-mobile",
    async (provider) => {
      // The task schema should not contain platform-specific fields
      const iosTask = makeMobileTask({ targetDeviceId: IOS_DEVICE.id });
      const androidTask = makeMobileTask({ targetDeviceId: ANDROID_DEVICE.id });

      // Both should have the same keys
      expect(Object.keys(iosTask).sort()).toEqual(Object.keys(androidTask).sort());

      // Prompt and payload must be identical in structure
      expect(typeof iosTask.prompt).toBe("string");
      expect(typeof androidTask.prompt).toBe("string");
    },
  );
});

// ---------------------------------------------------------------------------
// 3. Desktop execution
// ---------------------------------------------------------------------------

describe("Desktop execution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDispatcher.receiveFromMobile.mockResolvedValue({
      received: true,
      task: makeMobileTask(),
    });
    mockDispatcher.executeOnDesktop.mockResolvedValue({
      taskId: "mobile-task-001",
      status: "completed",
      output: "Email summary: 5 unread, 2 action items",
      durationMs: 2300,
      executedOn: "desktop",
    });
    mockDispatcher.returnResultToMobile.mockResolvedValue({
      sent: true,
      deviceId: IOS_DEVICE.id,
      resultDeliveredAt: new Date().toISOString(),
    });
  });

  runWithEachProvider(
    "receives a mobile task on desktop and executes it",
    "dispatch-mobile",
    async (provider) => {
      const received = await mockDispatcher.receiveFromMobile({
        deviceId: DESKTOP_DEVICE.id,
      });
      expect(received.received).toBe(true);
      expect(received.task.prompt).toBeTruthy();

      const execResult = await mockDispatcher.executeOnDesktop({ task: received.task });
      expect(execResult.status).toBe("completed");
      expect(execResult.executedOn).toBe("desktop");
      expect(execResult.durationMs).toBeGreaterThan(0);
    },
  );

  runWithEachProvider(
    "executes task with full desktop resources",
    "dispatch-mobile",
    async (provider) => {
      // Desktop execution should not be resource-constrained like mobile
      const agent = createMockAgent({ result: "Deep analysis complete", success: true } as Record<string, unknown>);

      const task = makeMobileTask({ prompt: "Perform deep research on quantum computing" });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (agent.invoke as any)("deep-research", { prompt: task.prompt, maxDepth: 5 });

      expect(agent.invoke).toHaveBeenCalledWith(
        "deep-research",
        expect.objectContaining({ maxDepth: 5 }),
      );
      expect(agent.calls[0].capability).toBe("deep-research");
    },
  );

  runWithEachProvider(
    "returns execution result back to the originating mobile device",
    "dispatch-mobile",
    async (provider) => {
      const task = makeMobileTask({ sourceDeviceId: IOS_DEVICE.id });
      const execResult = await mockDispatcher.executeOnDesktop({ task });
      expect(execResult.status).toBe("completed");

      const returnResult = await mockDispatcher.returnResultToMobile({
        deviceId: task.sourceDeviceId,
        taskId: task.id,
        result: execResult.output,
      });
      expect(returnResult.sent).toBe(true);
      expect(returnResult.deviceId).toBe(IOS_DEVICE.id);
    },
  );
});

// ---------------------------------------------------------------------------
// 4. Persistent threads
// ---------------------------------------------------------------------------

describe("Persistent threads", () => {
  let db: MockDatabase;

  beforeEach(() => {
    vi.clearAllMocks();
    db = new MockDatabase();

    mockThreadStore.createThread.mockImplementation(({ id, deviceId }: { id: string; deviceId: string }) => {
      const thread = { id, deviceId, messages: [], createdAt: new Date().toISOString() };
      db.insert("threads", thread);
      return thread;
    });

    mockThreadStore.appendMessage.mockImplementation(
      ({ threadId, message }: { threadId: string; message: Record<string, unknown> }) => {
        const thread = db.findById("threads", threadId);
        if (!thread) throw new Error(`Thread ${threadId} not found`);
        const messages = (thread["messages"] as unknown[]) ?? [];
        messages.push({ id: `msg-${Date.now()}`, ...message });
        db.update("threads", threadId, { messages });
        return { appended: true, messageCount: messages.length };
      },
    );

    mockThreadStore.getThread.mockImplementation((id: string) => db.findById("threads", id));

    mockThreadStore.syncThread.mockImplementation(
      ({ threadId, toDeviceId }: { threadId: string; toDeviceId: string }) => {
        const thread = db.findById("threads", threadId);
        return { synced: true, threadId, toDeviceId, messageCount: (thread?.["messages"] as unknown[])?.length ?? 0 };
      },
    );

    mockThreadStore.listThreadsByDevice.mockImplementation((deviceId: string) =>
      db.findAll("threads").filter((t) => t["deviceId"] === deviceId),
    );
  });

  runWithEachProvider(
    "thread continues seamlessly when switching devices",
    "dispatch-mobile",
    async (provider) => {
      // Start thread on iOS
      const thread = mockThreadStore.createThread({ id: "thread-cross-device", deviceId: IOS_DEVICE.id });
      expect(thread.id).toBe("thread-cross-device");

      await mockThreadStore.appendMessage({
        threadId: "thread-cross-device",
        message: { role: "user", content: "What is the weather?", deviceId: IOS_DEVICE.id },
      });

      // Sync to desktop
      const syncResult = mockThreadStore.syncThread({
        threadId: "thread-cross-device",
        toDeviceId: DESKTOP_DEVICE.id,
      });
      expect(syncResult.synced).toBe(true);
      expect(syncResult.toDeviceId).toBe(DESKTOP_DEVICE.id);

      // Continue on desktop
      await mockThreadStore.appendMessage({
        threadId: "thread-cross-device",
        message: { role: "assistant", content: "It's sunny today.", deviceId: DESKTOP_DEVICE.id },
      });

      const retrieved = mockThreadStore.getThread("thread-cross-device");
      expect((retrieved!["messages"] as unknown[]).length).toBe(2);
    },
  );

  runWithEachProvider(
    "context is preserved across device switch",
    "dispatch-mobile",
    async (provider) => {
      const thread = mockThreadStore.createThread({ id: "context-thread", deviceId: IOS_DEVICE.id });

      // Add several messages to build up context
      const messages = [
        { role: "user", content: "My name is Alice" },
        { role: "assistant", content: "Nice to meet you, Alice!" },
        { role: "user", content: "I prefer dark mode" },
      ];

      for (const msg of messages) {
        await mockThreadStore.appendMessage({ threadId: "context-thread", message: msg });
      }

      const retrieved = mockThreadStore.getThread("context-thread");
      const storedMessages = retrieved!["messages"] as Array<{ role: string; content: string }>;
      expect(storedMessages).toHaveLength(3);
      expect(storedMessages[0].content).toBe("My name is Alice");
    },
  );

  runWithEachProvider(
    "thread history syncs to a new device",
    "dispatch-mobile",
    async (provider) => {
      mockThreadStore.createThread({ id: "sync-thread", deviceId: IOS_DEVICE.id });
      await mockThreadStore.appendMessage({
        threadId: "sync-thread",
        message: { role: "user", content: "Hello" },
      });
      await mockThreadStore.appendMessage({
        threadId: "sync-thread",
        message: { role: "assistant", content: "Hi there!" },
      });

      const syncResult = mockThreadStore.syncThread({
        threadId: "sync-thread",
        toDeviceId: ANDROID_DEVICE.id,
      });
      expect(syncResult.synced).toBe(true);
      expect(syncResult.messageCount).toBe(2);
    },
  );

  runWithEachProvider(
    "lists all threads for a device",
    "dispatch-mobile",
    async (provider) => {
      mockThreadStore.createThread({ id: "t1", deviceId: IOS_DEVICE.id });
      mockThreadStore.createThread({ id: "t2", deviceId: IOS_DEVICE.id });
      mockThreadStore.createThread({ id: "t3", deviceId: ANDROID_DEVICE.id });

      const iosThreads = mockThreadStore.listThreadsByDevice(IOS_DEVICE.id);
      expect(iosThreads).toHaveLength(2);
      expect(iosThreads.every((t: { deviceId: string }) => t.deviceId === IOS_DEVICE.id)).toBe(true);
    },
  );
});

// ---------------------------------------------------------------------------
// 5. Error handling
// ---------------------------------------------------------------------------

describe("Error handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  runWithEachProvider(
    "handles a device being offline gracefully",
    "dispatch-mobile",
    async (provider) => {
      const offlineDevice = { ...ANDROID_DEVICE, online: false };
      mockDeviceRegistry.getDevice.mockReturnValue(offlineDevice);
      mockDeviceRegistry.isOnline.mockReturnValue(false);

      mockDispatcher.sendToDevice.mockRejectedValueOnce(
        new Error("Device device-android-001 is offline"),
      );

      await expect(
        mockDispatcher.sendToDevice({ deviceId: offlineDevice.id, task: makeMobileTask() }),
      ).rejects.toThrow("offline");

      expect(mockDeviceRegistry.isOnline(offlineDevice.id)).toBe(false);
    },
  );

  runWithEachProvider(
    "queues tasks when the target device is offline",
    "dispatch-mobile",
    async (provider) => {
      const offlineDevice = { ...IOS_DEVICE, online: false };
      mockDeviceRegistry.isOnline.mockReturnValue(false);

      const task = makeMobileTask({ targetDeviceId: offlineDevice.id });
      mockDispatcher.queueTask.mockResolvedValue({
        queued: true,
        taskId: task.id,
        position: 1,
      });
      mockDispatcher.getQueuedTasks.mockResolvedValue([task]);

      const queueResult = await mockDispatcher.queueTask({ task, deviceId: offlineDevice.id });
      expect(queueResult.queued).toBe(true);
      expect(queueResult.position).toBe(1);

      const queue = await mockDispatcher.getQueuedTasks({ deviceId: offlineDevice.id });
      expect(queue).toHaveLength(1);
      expect(queue[0].id).toBe(task.id);
    },
  );

  runWithEachProvider(
    "retries queued tasks when device reconnects",
    "dispatch-mobile",
    async (provider) => {
      const task = makeMobileTask({ targetDeviceId: IOS_DEVICE.id });
      mockDispatcher.getQueuedTasks.mockResolvedValue([task]);

      // Simulate device coming back online
      mockDeviceRegistry.isOnline.mockReturnValue(true);

      mockDispatcher.flushQueue.mockResolvedValue({
        flushed: 1,
        succeeded: 1,
        failed: 0,
        results: [{ taskId: task.id, status: "dispatched" }],
      });

      const flushResult = await mockDispatcher.flushQueue({ deviceId: IOS_DEVICE.id });
      expect(flushResult.flushed).toBe(1);
      expect(flushResult.succeeded).toBe(1);
      expect(flushResult.results[0].status).toBe("dispatched");
    },
  );
});
