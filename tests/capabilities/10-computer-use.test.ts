/**
 * Capability: Computer Use
 * Tests desktop automation: mouse control, keyboard input, screen reading.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runWithEachProvider, mockProviderEnv, type ProviderConfig } from './_setup/providerMatrix';
import { createLLMClientMock, expectValidJson, buildToolCallMock } from './_setup/testHelpers';

vi.mock('../../server/db', () => ({ db: {} }));
vi.mock('robotjs', () => ({
  default: {
    moveMouse: vi.fn(),
    mouseClick: vi.fn(),
    typeString: vi.fn(),
    keyTap: vi.fn(),
    screen: { capture: vi.fn().mockReturnValue({ width: 1920, height: 1080, image: Buffer.alloc(100) }) },
    getMousePos: vi.fn().mockReturnValue({ x: 960, y: 540 }),
  },
}));

type ComputerAction =
  | { type: 'screenshot' }
  | { type: 'click'; x: number; y: number; button?: 'left' | 'right' }
  | { type: 'type'; text: string }
  | { type: 'key'; key: string }
  | { type: 'move'; x: number; y: number }
  | { type: 'scroll'; x: number; y: number; direction: 'up' | 'down'; amount: number };

interface ComputerUseResult {
  actionsExecuted: number;
  screenshotsTaken: number;
  typedText: string[];
  keysPressed: string[];
  finalState: { mouseX: number; mouseY: number };
  provider: string;
}

async function executeComputerActions(
  task: string,
  provider: ProviderConfig,
  llmClient: ReturnType<typeof createLLMClientMock>,
): Promise<ComputerUseResult> {
  const COMPUTER_TOOLS = [
    {
      type: 'function',
      function: {
        name: 'computer_use',
        description: 'Control the computer',
        parameters: {
          type: 'object',
          properties: { action: { type: 'object' } },
        },
      },
    },
  ];

  const response = await llmClient.chat.completions.create({
    model: provider.model,
    messages: [
      { role: 'system', content: 'Execute computer use tasks. Use computer_use tool for each action.' },
      { role: 'user', content: task },
    ],
    tools: COMPUTER_TOOLS,
  });

  // Parse tool calls or content
  const content = response.choices[0].message.content;
  const spec = expectValidJson(content);
  const actions = (spec.actions as ComputerAction[]) ?? [];

  const typedText: string[] = [];
  const keysPressed: string[] = [];
  let screenshotsTaken = 0;
  let mouseX = 960;
  let mouseY = 540;

  for (const action of actions) {
    if (action.type === 'screenshot') screenshotsTaken++;
    else if (action.type === 'type') typedText.push(action.text);
    else if (action.type === 'key') keysPressed.push(action.key);
    else if (action.type === 'move' || action.type === 'click') {
      mouseX = action.x;
      mouseY = action.y;
    }
  }

  return {
    actionsExecuted: actions.length,
    screenshotsTaken,
    typedText,
    keysPressed,
    finalState: { mouseX, mouseY },
    provider: provider.name,
  };
}

const COMPUTER_USE_RESPONSE = JSON.stringify({
  actions: [
    { type: 'screenshot' },
    { type: 'move', x: 400, y: 300 },
    { type: 'click', x: 400, y: 300, button: 'left' },
    { type: 'type', text: 'Hello World' },
    { type: 'key', key: 'enter' },
    { type: 'screenshot' },
  ],
});

runWithEachProvider('Computer Use', (provider: ProviderConfig) => {
  let llmMock: ReturnType<typeof createLLMClientMock>;

  mockProviderEnv(provider);

  beforeEach(() => {
    vi.clearAllMocks();
    llmMock = createLLMClientMock({ content: COMPUTER_USE_RESPONSE, model: provider.model });
  });

  it('executes a sequence of actions', async () => {
    const result = await executeComputerActions('Open notepad and type hello', provider, llmMock);
    expect(result.actionsExecuted).toBeGreaterThan(0);
  });

  it('takes screenshots when requested', async () => {
    const result = await executeComputerActions('Screenshot the screen', provider, llmMock);
    expect(result.screenshotsTaken).toBeGreaterThanOrEqual(1);
  });

  it('types text correctly', async () => {
    const result = await executeComputerActions('Type Hello World', provider, llmMock);
    expect(result.typedText).toContain('Hello World');
  });

  it('presses keyboard keys', async () => {
    const result = await executeComputerActions('Press Enter', provider, llmMock);
    expect(result.keysPressed).toContain('enter');
  });

  it('moves mouse to specified coordinates', async () => {
    const result = await executeComputerActions('Click at 400,300', provider, llmMock);
    expect(result.finalState.mouseX).toBe(400);
    expect(result.finalState.mouseY).toBe(300);
  });

  it('calls LLM once per task', async () => {
    await executeComputerActions('Simple task', provider, llmMock);
    expect(llmMock.chat.completions.create).toHaveBeenCalledTimes(1);
  });

  it('uses correct model', async () => {
    await executeComputerActions('Test', provider, llmMock);
    const call = llmMock.chat.completions.create.mock.calls[0][0];
    expect(call.model).toBe(provider.model);
  });

  it('sets provider name', async () => {
    const result = await executeComputerActions('Any', provider, llmMock);
    expect(result.provider).toBe(provider.name);
  });

  it('handles multi-screenshot tasks', async () => {
    const multiScreenshot = JSON.stringify({
      actions: [
        { type: 'screenshot' },
        { type: 'click', x: 100, y: 100, button: 'left' },
        { type: 'screenshot' },
        { type: 'click', x: 200, y: 200, button: 'left' },
        { type: 'screenshot' },
      ],
    });
    const mock = createLLMClientMock({ content: multiScreenshot, model: provider.model });
    const result = await executeComputerActions('Multi-screenshot task', provider, mock);
    expect(result.screenshotsTaken).toBe(3);
  });

  it('handles empty actions gracefully', async () => {
    const empty = JSON.stringify({ actions: [] });
    const mock = createLLMClientMock({ content: empty, model: provider.model });
    const result = await executeComputerActions('No-op task', provider, mock);
    expect(result.actionsExecuted).toBe(0);
  });

  it('tracks multiple typed strings', async () => {
    const multiType = JSON.stringify({
      actions: [
        { type: 'type', text: 'First line' },
        { type: 'key', key: 'enter' },
        { type: 'type', text: 'Second line' },
      ],
    });
    const mock = createLLMClientMock({ content: multiType, model: provider.model });
    const result = await executeComputerActions('Type two lines', provider, mock);
    expect(result.typedText).toHaveLength(2);
    expect(result.typedText[0]).toBe('First line');
    expect(result.typedText[1]).toBe('Second line');
  });
});
