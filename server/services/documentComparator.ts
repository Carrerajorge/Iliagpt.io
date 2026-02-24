/**
 * Document Comparator Service
 * 
 * Compares two versions of a document and highlights differences.
 * Useful for detecting changes between document versions.
 */

// =============================================================================
// Types
// =============================================================================

export interface DocumentDiff {
    additions: DiffSegment[];
    deletions: DiffSegment[];
    modifications: DiffSegment[];
    unchanged: number; // Percentage unchanged
    similarity: number; // 0-1 similarity score
    summary: string;
}

export interface DiffSegment {
    content: string;
    lineNumber?: number;
    position: { start: number; end: number };
    type: 'add' | 'delete' | 'modify';
    context?: string; // Surrounding text for context
}

export interface ComparisonResult {
    diff: DocumentDiff;
    sideBySide: SideBySideView[];
    processingTimeMs: number;
    keyChanges: string[];
}

export interface SideBySideView {
    lineNumber: number;
    leftContent: string;
    rightContent: string;
    status: 'same' | 'modified' | 'added' | 'deleted';
}

// =============================================================================
// Diff Algorithm (Simplified LCS-based)
// =============================================================================

function longestCommonSubsequence(a: string[], b: string[]): number[][] {
    const m = a.length;
    const n = b.length;
    const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            if (a[i - 1] === b[j - 1]) {
                dp[i][j] = dp[i - 1][j - 1] + 1;
            } else {
                dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
            }
        }
    }

    return dp;
}

function backtrackLCS(
    dp: number[][],
    a: string[],
    b: string[],
    i: number,
    j: number,
    result: { type: 'same' | 'add' | 'delete'; value: string; indexA?: number; indexB?: number }[]
): void {
    if (i === 0 && j === 0) return;

    if (i === 0) {
        result.unshift({ type: 'add', value: b[j - 1], indexB: j - 1 });
        backtrackLCS(dp, a, b, i, j - 1, result);
    } else if (j === 0) {
        result.unshift({ type: 'delete', value: a[i - 1], indexA: i - 1 });
        backtrackLCS(dp, a, b, i - 1, j, result);
    } else if (a[i - 1] === b[j - 1]) {
        result.unshift({ type: 'same', value: a[i - 1], indexA: i - 1, indexB: j - 1 });
        backtrackLCS(dp, a, b, i - 1, j - 1, result);
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
        result.unshift({ type: 'delete', value: a[i - 1], indexA: i - 1 });
        backtrackLCS(dp, a, b, i - 1, j, result);
    } else {
        result.unshift({ type: 'add', value: b[j - 1], indexB: j - 1 });
        backtrackLCS(dp, a, b, i, j - 1, result);
    }
}

// =============================================================================
// Main Comparison Function
// =============================================================================

export function compareDocuments(
    documentA: string,
    documentB: string
): ComparisonResult {
    const startTime = Date.now();

    // Split into lines
    const linesA = documentA.split('\n');
    const linesB = documentB.split('\n');

    // Calculate LCS
    const dp = longestCommonSubsequence(linesA, linesB);
    const diffOps: { type: 'same' | 'add' | 'delete'; value: string; indexA?: number; indexB?: number }[] = [];
    backtrackLCS(dp, linesA, linesB, linesA.length, linesB.length, diffOps);

    // Convert to diff segments
    const additions: DiffSegment[] = [];
    const deletions: DiffSegment[] = [];
    const modifications: DiffSegment[] = [];
    const sideBySide: SideBySideView[] = [];

    let lineNum = 1;
    let posA = 0;
    let posB = 0;

    for (let i = 0; i < diffOps.length; i++) {
        const op = diffOps[i];

        if (op.type === 'same') {
            sideBySide.push({
                lineNumber: lineNum++,
                leftContent: op.value,
                rightContent: op.value,
                status: 'same'
            });
            posA += op.value.length + 1;
            posB += op.value.length + 1;
        } else if (op.type === 'delete') {
            // Check if next op is an add (modification)
            const nextOp = diffOps[i + 1];
            if (nextOp && nextOp.type === 'add') {
                modifications.push({
                    content: `"${op.value}" → "${nextOp.value}"`,
                    lineNumber: lineNum,
                    position: { start: posA, end: posA + op.value.length },
                    type: 'modify',
                    context: op.value.substring(0, 50)
                });
                sideBySide.push({
                    lineNumber: lineNum++,
                    leftContent: op.value,
                    rightContent: nextOp.value,
                    status: 'modified'
                });
                posA += op.value.length + 1;
                posB += nextOp.value.length + 1;
                i++; // Skip next add
            } else {
                deletions.push({
                    content: op.value,
                    lineNumber: lineNum,
                    position: { start: posA, end: posA + op.value.length },
                    type: 'delete'
                });
                sideBySide.push({
                    lineNumber: lineNum++,
                    leftContent: op.value,
                    rightContent: '',
                    status: 'deleted'
                });
                posA += op.value.length + 1;
            }
        } else if (op.type === 'add') {
            additions.push({
                content: op.value,
                lineNumber: lineNum,
                position: { start: posB, end: posB + op.value.length },
                type: 'add'
            });
            sideBySide.push({
                lineNumber: lineNum++,
                leftContent: '',
                rightContent: op.value,
                status: 'added'
            });
            posB += op.value.length + 1;
        }
    }

    // Calculate similarity
    const sameCount = diffOps.filter(op => op.type === 'same').length;
    const similarity = diffOps.length > 0 ? sameCount / diffOps.length : 1;
    const unchanged = Math.round(similarity * 100);

    // Generate key changes summary
    const keyChanges = generateKeyChangesSummary(additions, deletions, modifications);

    // Generate overall summary
    const summary = generateDiffSummary(additions, deletions, modifications, unchanged);

    return {
        diff: {
            additions,
            deletions,
            modifications,
            unchanged,
            similarity,
            summary
        },
        sideBySide,
        processingTimeMs: Date.now() - startTime,
        keyChanges
    };
}

// =============================================================================
// Helper Functions
// =============================================================================

function generateKeyChangesSummary(
    additions: DiffSegment[],
    deletions: DiffSegment[],
    modifications: DiffSegment[]
): string[] {
    const changes: string[] = [];

    if (additions.length > 0) {
        changes.push(`${additions.length} líneas añadidas`);
    }
    if (deletions.length > 0) {
        changes.push(`${deletions.length} líneas eliminadas`);
    }
    if (modifications.length > 0) {
        changes.push(`${modifications.length} líneas modificadas`);
    }

    // Extract significant changes (non-empty, non-whitespace)
    const significantAdditions = additions
        .filter(a => a.content.trim().length > 20)
        .slice(0, 3)
        .map(a => `+ "${a.content.substring(0, 50)}..."`);

    const significantDeletions = deletions
        .filter(d => d.content.trim().length > 20)
        .slice(0, 3)
        .map(d => `- "${d.content.substring(0, 50)}..."`);

    return [...changes, ...significantAdditions, ...significantDeletions];
}

function generateDiffSummary(
    additions: DiffSegment[],
    deletions: DiffSegment[],
    modifications: DiffSegment[],
    unchanged: number
): string {
    const totalChanges = additions.length + deletions.length + modifications.length;

    if (totalChanges === 0) {
        return 'Los documentos son idénticos.';
    }

    const parts: string[] = [];

    if (unchanged >= 90) {
        parts.push('Cambios menores detectados.');
    } else if (unchanged >= 70) {
        parts.push('Cambios moderados detectados.');
    } else if (unchanged >= 50) {
        parts.push('Cambios significativos detectados.');
    } else {
        parts.push('Los documentos son muy diferentes.');
    }

    parts.push(`${unchanged}% del contenido permanece igual.`);

    if (additions.length > 0) parts.push(`Se añadieron ${additions.length} secciones.`);
    if (deletions.length > 0) parts.push(`Se eliminaron ${deletions.length} secciones.`);
    if (modifications.length > 0) parts.push(`Se modificaron ${modifications.length} secciones.`);

    return parts.join(' ');
}

// =============================================================================
// Quick Comparison (for similarity check only)
// =============================================================================

export function quickCompare(textA: string, textB: string): number {
    if (textA === textB) return 1;
    if (!textA || !textB) return 0;

    // Jaccard similarity on words
    const wordsA = new Set(textA.toLowerCase().split(/\s+/));
    const wordsB = new Set(textB.toLowerCase().split(/\s+/));

    let intersection = 0;
    for (const word of wordsA) {
        if (wordsB.has(word)) intersection++;
    }

    const union = wordsA.size + wordsB.size - intersection;
    return union > 0 ? intersection / union : 0;
}

// =============================================================================
// Export
// =============================================================================

export const documentComparator = {
    compareDocuments,
    quickCompare
};

export default documentComparator;
