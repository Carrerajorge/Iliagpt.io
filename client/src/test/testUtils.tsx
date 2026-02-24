/**
 * Test Utilities
 * Shared test helpers and mocks for unit testing
 */

import React from 'react';
import { render, RenderOptions } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Create a fresh QueryClient for each test
function createTestQueryClient() {
    return new QueryClient({
        defaultOptions: {
            queries: {
                retry: false,
                gcTime: 0,
                staleTime: 0,
            },
            mutations: {
                retry: false,
            },
        },
    });
}

// Custom render with providers
interface CustomRenderOptions extends Omit<RenderOptions, 'wrapper'> {
    queryClient?: QueryClient;
}

export function renderWithProviders(
    ui: React.ReactElement,
    options: CustomRenderOptions = {}
) {
    const queryClient = options.queryClient ?? createTestQueryClient();

    function Wrapper({ children }: { children: React.ReactNode }) {
        return (
            <QueryClientProvider client={queryClient}>
                {children}
            </QueryClientProvider>
        );
    }

    return {
        ...render(ui, { wrapper: Wrapper, ...options }),
        queryClient,
    };
}

// ============================================
// MOCKS
// ============================================

// Mock fetch
export function mockFetch(response: any, options?: { status?: number; ok?: boolean }) {
    const mockResponse = {
        ok: options?.ok ?? true,
        status: options?.status ?? 200,
        json: async () => response,
        text: async () => JSON.stringify(response),
        blob: async () => new Blob([JSON.stringify(response)]),
    };

    return jest.fn().mockResolvedValue(mockResponse);
}

// Mock SSE stream
export function mockSSEStream(chunks: string[]) {
    const encoder = new TextEncoder();
    let index = 0;

    return new ReadableStream({
        async pull(controller) {
            if (index < chunks.length) {
                const chunk = `data: ${JSON.stringify({ content: chunks[index] })}\n\n`;
                controller.enqueue(encoder.encode(chunk));
                index++;
            } else {
                controller.close();
            }
        },
    });
}

// Mock WebSocket
export class MockWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;

    url: string;
    readyState = MockWebSocket.OPEN;
    onopen: ((event: Event) => void) | null = null;
    onclose: ((event: CloseEvent) => void) | null = null;
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: ((event: Event) => void) | null = null;

    private sentMessages: any[] = [];

    constructor(url: string) {
        this.url = url;
        setTimeout(() => this.onopen?.(new Event('open')), 0);
    }

    send(data: string) {
        this.sentMessages.push(JSON.parse(data));
    }

    close() {
        this.readyState = MockWebSocket.CLOSED;
        this.onclose?.(new CloseEvent('close'));
    }

    // Test helpers
    getSentMessages() {
        return this.sentMessages;
    }

    simulateMessage(data: any) {
        this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(data) }));
    }

    simulateError() {
        this.onerror?.(new Event('error'));
    }
}

// Mock localStorage
export function mockLocalStorage() {
    const store: Record<string, string> = {};

    return {
        getItem: jest.fn((key: string) => store[key] || null),
        setItem: jest.fn((key: string, value: string) => {
            store[key] = value;
        }),
        removeItem: jest.fn((key: string) => {
            delete store[key];
        }),
        clear: jest.fn(() => {
            Object.keys(store).forEach(key => delete store[key]);
        }),
        get length() {
            return Object.keys(store).length;
        },
        key: jest.fn((index: number) => Object.keys(store)[index] || null),
    };
}

// Mock IndexedDB
export function mockIndexedDB() {
    const stores: Record<string, Map<string, any>> = {};

    return {
        open: jest.fn().mockResolvedValue({
            objectStoreNames: {
                contains: (name: string) => name in stores,
            },
            transaction: jest.fn((names: string[]) => ({
                objectStore: jest.fn((name: string) => ({
                    get: jest.fn((key: string) => ({
                        result: stores[name]?.get(key),
                    })),
                    put: jest.fn((value: any) => {
                        if (!stores[name]) stores[name] = new Map();
                        stores[name].set(value.id, value);
                    }),
                    delete: jest.fn((key: string) => {
                        stores[name]?.delete(key);
                    }),
                    getAll: jest.fn(() => ({
                        result: Array.from(stores[name]?.values() || []),
                    })),
                })),
            })),
            createObjectStore: jest.fn((name: string) => {
                stores[name] = new Map();
                return {
                    createIndex: jest.fn(),
                };
            }),
        }),
    };
}

// ============================================
// TEST DATA FACTORIES
// ============================================

let messageIdCounter = 0;
let chatIdCounter = 0;

export function createMockMessage(overrides: Partial<{
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: Date;
}> = {}) {
    return {
        id: overrides.id ?? `msg-${++messageIdCounter}`,
        role: overrides.role ?? 'user',
        content: overrides.content ?? 'Test message',
        timestamp: overrides.timestamp ?? new Date(),
    };
}

export function createMockChat(overrides: Partial<{
    id: string;
    title: string;
    messages: any[];
    createdAt: Date;
    updatedAt: Date;
}> = {}) {
    return {
        id: overrides.id ?? `chat-${++chatIdCounter}`,
        title: overrides.title ?? 'Test Chat',
        messages: overrides.messages ?? [],
        createdAt: overrides.createdAt ?? new Date(),
        updatedAt: overrides.updatedAt ?? new Date(),
    };
}

export function createMockUser(overrides: Partial<{
    id: number;
    email: string;
    name: string;
    avatar: string;
}> = {}) {
    return {
        id: overrides.id ?? 1,
        email: overrides.email ?? 'test@example.com',
        name: overrides.name ?? 'Test User',
        avatar: overrides.avatar ?? '',
    };
}

// ============================================
// ASSERTIONS
// ============================================

export function expectToHaveBeenCalledWithMatch(
    mockFn: jest.Mock,
    expected: Record<string, any>
) {
    expect(mockFn).toHaveBeenCalledWith(
        expect.objectContaining(expected)
    );
}

export function expectStreamedContent(
    mockFn: jest.Mock,
    expectedContent: string
) {
    const allCalls = mockFn.mock.calls.map(call => call[0]).join('');
    expect(allCalls).toContain(expectedContent);
}

// ============================================
// WAIT UTILITIES
// ============================================

export function waitForNextTick(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 0));
}

export function waitFor(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export async function waitForCondition(
    condition: () => boolean,
    timeout: number = 5000,
    interval: number = 100
): Promise<void> {
    const startTime = Date.now();

    while (!condition()) {
        if (Date.now() - startTime > timeout) {
            throw new Error('Condition not met within timeout');
        }
        await waitFor(interval);
    }
}

// Re-export testing library utilities
export * from '@testing-library/react';
export { renderWithProviders as render };
