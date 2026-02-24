/**
 * Vitest Setup File for Frontend Tests
 * Configures the testing environment before tests run
 */

import '@testing-library/jest-dom';
import { vi, beforeAll, afterEach, afterAll } from 'vitest';

// Mock window.matchMedia
beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });

  // Mock ResizeObserver
  window.ResizeObserver = vi.fn().mockImplementation(() => ({
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
  }));

  // Mock IntersectionObserver
  window.IntersectionObserver = vi.fn().mockImplementation(() => ({
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
    root: null,
    rootMargin: '',
    thresholds: [],
  }));

  // Mock scrollIntoView
  Element.prototype.scrollIntoView = vi.fn();

  // Mock clipboard API
  Object.defineProperty(navigator, 'clipboard', {
    value: {
      writeText: vi.fn().mockResolvedValue(undefined),
      readText: vi.fn().mockResolvedValue(''),
    },
    writable: true,
  });

  // Mock speech recognition
  (window as any).SpeechRecognition = vi.fn();
  (window as any).webkitSpeechRecognition = vi.fn();

  // Mock speech synthesis
  Object.defineProperty(window, 'speechSynthesis', {
    value: {
      speak: vi.fn(),
      cancel: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      getVoices: vi.fn().mockReturnValue([]),
      pending: false,
      speaking: false,
      paused: false,
    },
    writable: true,
  });
});

// Cleanup after each test
afterEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = '';
});

// Global cleanup
afterAll(() => {
  vi.restoreAllMocks();
});

// Suppress console errors/warnings in tests (optional)
// Uncomment if you want cleaner test output
// vi.spyOn(console, 'error').mockImplementation(() => {});
// vi.spyOn(console, 'warn').mockImplementation(() => {});

// Mock fetch globally
global.fetch = vi.fn();

// Mock URL.createObjectURL
global.URL.createObjectURL = vi.fn(() => 'blob:mock-url');
global.URL.revokeObjectURL = vi.fn();

// Export vitest globals for use in tests
export { vi };
