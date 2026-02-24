
import { describe, it, expect } from 'vitest';

export const add = (a: number, b: number) => a + b;
export const calculateGrowth = (current: number, previous: number) => {
    if (previous === 0) return 0;
    return ((current - previous) / previous) * 100;
};

describe('Math Utils (QA Proof of Concept)', () => {
    it('should correctly add numbers', () => {
        expect(add(2, 3)).toBe(5);
    });

    it('should calculate growth percentage', () => {
        expect(calculateGrowth(120, 100)).toBe(20);
        expect(calculateGrowth(80, 100)).toBe(-20);
    });

    it('should handle division by zero', () => {
        expect(calculateGrowth(100, 0)).toBe(0);
    });
});
