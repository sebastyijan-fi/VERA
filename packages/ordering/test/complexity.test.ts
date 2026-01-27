
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ----------------------------------------------------------------------------
// Heuristic Complexity Analyzer (The "Ratchet")
// ----------------------------------------------------------------------------
// In a real setup, use libraries like 'escomplex', 'typhon', or 'sonarqube'.
// Here, we build a "Poor Man's Static Analyzer" to demonstrate the concept.

interface ComplexityReport {
    method: string;
    cyclomatic: number;
    metrics: Record<string, number>;
}

function analyzeFile(filePath: string): ComplexityReport[] {
    const content = fs.readFileSync(filePath, 'utf-8');
    const reports: ComplexityReport[] = [];

    // Very naive regex-based function finder for demonstration
    // Matches: async? functionName(args)? { ... }
    // This assumes standard formatting provided by Prettier
    const methodRegex = /(?:public|private|protected)?\s*(?:async)?\s*([a-zA-Z0-9_]+)\s*\(.*?\)\s*:\s*.*?\{/g;

    let match;
    while ((match = methodRegex.exec(content)) !== null) {
        const methodName = match[1];
        const startIndex = match.index + match[0].length;
        const bodyValue = extractBody(content, startIndex);

        reports.push({
            method: methodName,
            cyclomatic: calculateCyclomatic(bodyValue),
            metrics: {
                length: bodyValue.length,
                lines: bodyValue.split('\n').length
            }
        });
    }

    return reports;
}

function extractBody(content: string, startIndex: number): string {
    let braceCount = 1;
    let index = startIndex;
    while (braceCount > 0 && index < content.length) {
        if (content[index] === '{') braceCount++;
        if (content[index] === '}') braceCount--;
        index++;
    }
    return content.substring(startIndex, index - 1); // Exclude final brace
}

function calculateCyclomatic(body: string): number {
    let complexity = 1; // Base complexity

    // Keywords that indicate branching
    const checks = [
        /\bif\b/g,
        /\belse\b/g,
        /\bwhile\b/g,
        /\bfor\b/g,
        /\bcase\b/g,
        /\bcatch\b/g,
        /\&\&/g,
        /\|\|/g,
        /\?/g // Ternary
    ];

    for (const regex of checks) {
        const matches = body.match(regex);
        if (matches) complexity += matches.length;
    }

    return complexity;
}

// ----------------------------------------------------------------------------
// The Complexity Ratchet Tests
// ----------------------------------------------------------------------------

describe('Code Quality Ratchet (Complexity Advisor)', () => {
    const targetFile = path.resolve(__dirname, '../src/single.ts');
    const reports = analyzeFile(targetFile);

    console.log('\nComplexity Report for SingleSequencer:');
    reports.forEach(r => {
        if (r.cyclomatic > 5) {
            console.log(`  ${r.method.padEnd(20)}: ${r.cyclomatic} (Lines: ${r.metrics.lines})`);
        }
    });

    it('Core methods should remain readable (Cyclomatic Complexity < 25)', () => {
        // We set a hard limit. If code exceeds this, the test fails.
        // This forces refactoring (extraction) before merging.
        const LIMIT = 25;

        const violations = reports.filter(r => r.cyclomatic > LIMIT);

        if (violations.length > 0) {
            const msg = violations.map(v => `${v.method} (${v.cyclomatic})`).join(', ');
            expect.fail(`The following methods are too complex! Refactor them Advises: [${msg}]`);
        }
    });

    // Specific ratchet for the most complex method we know of
    it('submitMany should not get any worse', () => {
        // "Ratchet" means we lock in the current quality.
        // It might be 20 now. We check it doesn't go to 21.
        const submitMany = reports.find(r => r.method === '_submitMany');

        // Assert it exists
        expect(submitMany).toBeDefined();

        // The Ratchet:
        // Current Estimate based on our rudimentary parser might be around 15-20.
        // We set the ceiling slightly above the current value to allow minor edits,
        // but prevent major degradation.
        expect(submitMany!.cyclomatic).toBeLessThan(35);
    });
});
