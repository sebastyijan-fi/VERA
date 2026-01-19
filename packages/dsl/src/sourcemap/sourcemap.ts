/**
 * VERA DSL Source Maps
 *
 * Maps IR instructions and runtime errors back to source locations.
 * Enables better error messages and debugging.
 */

import type { SourceSpan } from '../lexer/tokens.js';
import type { IRProgram } from '../ir/types.js';

// ============================================================================
// Source Map Types
// ============================================================================

/**
 * A single source mapping entry
 */
export interface SourceMapEntry {
    /** IR instruction index */
    index: number;
    /** Function name */
    function: string;
    /** Source span */
    span: SourceSpan;
}

/**
 * Complete source map for an IR program
 */
export interface SourceMap {
    /** Source file name or path */
    source: string;
    /** Module name */
    module: string;
    /** Mapping entries sorted by instruction index */
    mappings: SourceMapEntry[];
}

// ============================================================================
// Source Map Builder
// ============================================================================

/**
 * Builds a source map from an IR program
 */
export class SourceMapBuilder {
    private mappings: SourceMapEntry[] = [];

    /**
     * Builds a source map from an IR program
     */
    build(program: IRProgram, sourcePath: string): SourceMap {
        this.mappings = [];

        for (const func of program.functions) {
            let index = 0;
            for (const instruction of func.instructions) {
                if (instruction.span) {
                    this.mappings.push({
                        index,
                        function: func.name,
                        span: instruction.span,
                    });
                }
                index++;
            }
        }

        // Sort by function then index for efficient lookup
        this.mappings.sort((a, b) => {
            const funcCmp = a.function.localeCompare(b.function);
            if (funcCmp !== 0) return funcCmp;
            return a.index - b.index;
        });

        return {
            source: sourcePath,
            module: program.name,
            mappings: this.mappings,
        };
    }
}

// ============================================================================
// Source Map Query
// ============================================================================

/**
 * Queries source maps for location information
 */
export class SourceMapQuery {
    private readonly map: SourceMap;
    private readonly functionMaps: Map<string, SourceMapEntry[]>;

    constructor(map: SourceMap) {
        this.map = map;
        this.functionMaps = new Map();

        // Build per-function index
        for (const entry of map.mappings) {
            let entries = this.functionMaps.get(entry.function);
            if (!entries) {
                entries = [];
                this.functionMaps.set(entry.function, entries);
            }
            entries.push(entry);
        }
    }

    /**
     * Gets source location for an IR instruction
     */
    getLocation(functionName: string, instructionIndex: number): SourceSpan | undefined {
        const entries = this.functionMaps.get(functionName);
        if (!entries) return undefined;

        // Binary search for exact match or closest preceding entry
        let low = 0;
        let high = entries.length - 1;
        let result: SourceMapEntry | undefined;

        while (low <= high) {
            const mid = Math.floor((low + high) / 2);
            const entry = entries[mid]!;

            if (entry.index === instructionIndex) {
                return entry.span;
            } else if (entry.index < instructionIndex) {
                result = entry;
                low = mid + 1;
            } else {
                high = mid - 1;
            }
        }

        return result?.span;
    }

    /**
     * Formats a source location as a human-readable string
     */
    formatLocation(span: SourceSpan): string {
        const { start, end } = span;
        if (start.line === end.line) {
            if (start.column === end.column) {
                return `${this.map.source}:${start.line}:${start.column}`;
            }
            return `${this.map.source}:${start.line}:${start.column}-${end.column}`;
        }
        return `${this.map.source}:${start.line}:${start.column}-${end.line}:${end.column}`;
    }

    /**
     * Gets the source file path
     */
    get source(): string {
        return this.map.source;
    }

    /**
     * Gets the module name
     */
    get module(): string {
        return this.map.module;
    }
}

// ============================================================================
// Error Formatting
// ============================================================================

/**
 * Runtime error with source information
 */
export interface SourcedError {
    message: string;
    code: string;
    location?: SourceSpan;
    functionName?: string;
    instructionIndex?: number;
}

/**
 * Formats a runtime error with source context
 */
export function formatError(
    error: SourcedError,
    sourceMap: SourceMapQuery,
    sourceCode?: string
): string {
    const lines: string[] = [];

    // Error header
    lines.push(`Error: ${error.message} [${error.code}]`);

    // Location info
    if (error.location) {
        lines.push(`  at ${sourceMap.formatLocation(error.location)}`);

        // Show source context if available
        if (sourceCode) {
            const context = getSourceContext(sourceCode, error.location);
            if (context) {
                lines.push('');
                lines.push(context);
            }
        }
    } else if (error.functionName !== undefined && error.instructionIndex !== undefined) {
        const location = sourceMap.getLocation(error.functionName, error.instructionIndex);
        if (location) {
            lines.push(`  at ${sourceMap.formatLocation(location)}`);
            if (sourceCode) {
                const context = getSourceContext(sourceCode, location);
                if (context) {
                    lines.push('');
                    lines.push(context);
                }
            }
        } else {
            lines.push(`  in function ${error.functionName} at instruction ${error.instructionIndex}`);
        }
    }

    return lines.join('\n');
}

/**
 * Extracts source context around an error location
 */
function getSourceContext(source: string, span: SourceSpan): string | undefined {
    const lines = source.split('\n');
    const lineIndex = span.start.line - 1;

    if (lineIndex < 0 || lineIndex >= lines.length) {
        return undefined;
    }

    const line = lines[lineIndex]!;
    const lineNum = String(span.start.line).padStart(4, ' ');
    const pointer = ' '.repeat(span.start.column - 1 + 7) + '^';

    return `${lineNum} | ${line}\n${pointer}`;
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Builds a source map from an IR program
 */
export function buildSourceMap(program: IRProgram, sourcePath: string): SourceMap {
    return new SourceMapBuilder().build(program, sourcePath);
}

/**
 * Creates a source map query interface
 */
export function querySourceMap(map: SourceMap): SourceMapQuery {
    return new SourceMapQuery(map);
}
