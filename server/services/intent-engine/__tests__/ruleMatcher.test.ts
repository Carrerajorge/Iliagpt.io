
import { describe, it, expect, vi, beforeEach } from 'vitest';

// NOTE: In ESM, Node core module namespace exports are not configurable, so vi.spyOn(fs, ...)
// will throw. Mock the module instead.
vi.mock('fs', async () => {
    const actual = await vi.importActual<typeof import('fs')>('fs');
    return {
        ...actual,
        existsSync: vi.fn(() => true),
    };
});

import * as fs from 'fs';

// Mock pathSecurity before importing the module under test
// intent-engine/__tests__ -> intent-engine -> services -> server -> utils
vi.mock('../../../utils/pathSecurity', () => ({
    resolveSafePath: vi.fn((p) => {
        if (p.includes('..')) throw new Error('Unsafe path');
        return `/safe/${p}`;
    }),
}));

// Import the real functions
import { extractSlots, ruleBasedMatch } from '../ruleMatcher';

describe('RuleMatcher', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        (fs.existsSync as any).mockReturnValue(true);
    });

    describe('extractSlots', () => {
        it('should detect page numbers', () => {
            const text = "read page 5 and 10";
            // extractSlots(normalized, original) -> we simply pass same text for both in simple tests
            const result = extractSlots(text, text);
            expect(result.page_numbers).toEqual([5, 10]);
        });

        it('should detect page ranges', () => {
            const text = "pages 10-20";
            const result = extractSlots(text, text);
            expect(result.page_range).toEqual({ start: 10, end: 20 });
        });

        it('should detect safe file paths', () => {
            const text = "analyze data.csv";
            // fs.existsSync is mocked to true
            const result = extractSlots(text, text);
            expect(result.file_paths).toContain('/safe/data.csv');
        });

        it('should reject unsafe file paths (mocked)', () => {
            const text = "analyze ../secret.txt";
            // The mock throws error, extractSlots catches it and ignores
            const result = extractSlots(text, text);
            expect(result.file_paths).toBeUndefined();
        });
    });

    describe('ruleBasedMatch', () => {
        it('should detect INTENT for specific keywords', () => {
            const text = "create a presentation about AI";
            const result = ruleBasedMatch(text, 'en');
            // We expect CREATE_PRESENTATION or similar
            expect(result.intent).toBe('CREATE_PRESENTATION');
        });
    });
});
