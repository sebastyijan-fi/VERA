/**
 * VERA DSL Token Types
 *
 * Defines all token types used by the VERA DSL lexer.
 * Based on the EBNF grammar from the VERA specification.
 */

// ============================================================================
// Token Type Enum
// ============================================================================

export enum TokenType {
    // Literals
    IDENTIFIER = 'IDENTIFIER',
    INTEGER = 'INTEGER',
    STRING = 'STRING',
    BYTES = 'BYTES',
    TRUE = 'TRUE',
    FALSE = 'FALSE',

    // Keywords - Module structure
    MODULE = 'MODULE',
    IMPORT = 'IMPORT',
    FROM = 'FROM',
    AS = 'AS',
    EXPORT = 'EXPORT',

    // Keywords - Type definitions
    TYPE = 'TYPE',
    ENTITY = 'ENTITY',
    ENUM = 'ENUM',
    STRUCT = 'STRUCT',

    // Keywords - Transaction definitions
    TRANSACTION = 'TRANSACTION',
    PARAM = 'PARAM',
    REQUIRE = 'REQUIRE',
    ENSURE = 'ENSURE',
    EMIT = 'EMIT',
    LET = 'LET',
    SET = 'SET',
    DELETE = 'DELETE',
    IF = 'IF',
    ELSE = 'ELSE',
    FOR = 'FOR',
    IN = 'IN',
    WHILE = 'WHILE',
    BREAK = 'BREAK',
    CONTINUE = 'CONTINUE',
    RETURN = 'RETURN',

    // Keywords - Events
    EVENT = 'EVENT',

    // Keywords - Invariants
    INVARIANT = 'INVARIANT',

    // Keywords - Access control
    PUBLIC = 'PUBLIC',
    PRIVATE = 'PRIVATE',

    // Keywords - State
    STATE = 'STATE',
    GET = 'GET',
    EXISTS = 'EXISTS',

    // Keywords - Types
    ADDRESS = 'ADDRESS',
    UINT = 'UINT',
    INT = 'INT',
    BOOL = 'BOOL',
    STRING_TYPE = 'STRING_TYPE',
    BYTES_TYPE = 'BYTES_TYPE',
    FIXED = 'FIXED',
    LIST = 'LIST',
    MAP = 'MAP',
    OPTIONAL = 'OPTIONAL',

    // Keywords - Context
    CALLER = 'CALLER',
    BLOCK = 'BLOCK',
    THIS = 'THIS',

    // Operators - Arithmetic
    PLUS = 'PLUS',
    MINUS = 'MINUS',
    STAR = 'STAR',
    SLASH = 'SLASH',
    PERCENT = 'PERCENT',

    // Operators - Comparison
    EQ = 'EQ',
    NEQ = 'NEQ',
    LT = 'LT',
    GT = 'GT',
    LTE = 'LTE',
    GTE = 'GTE',

    // Operators - Logical
    AND = 'AND',
    OR = 'OR',
    NOT = 'NOT',

    // Operators - Assignment
    ASSIGN = 'ASSIGN',
    PLUS_ASSIGN = 'PLUS_ASSIGN',
    MINUS_ASSIGN = 'MINUS_ASSIGN',

    // Delimiters
    LPAREN = 'LPAREN',
    RPAREN = 'RPAREN',
    LBRACE = 'LBRACE',
    RBRACE = 'RBRACE',
    LBRACKET = 'LBRACKET',
    RBRACKET = 'RBRACKET',
    COMMA = 'COMMA',
    COLON = 'COLON',
    SEMICOLON = 'SEMICOLON',
    DOT = 'DOT',
    ARROW = 'ARROW',
    DOUBLE_COLON = 'DOUBLE_COLON',
    QUESTION = 'QUESTION',

    // Special
    NEWLINE = 'NEWLINE',
    COMMENT = 'COMMENT',
    EOF = 'EOF',
    INVALID = 'INVALID',
}

// ============================================================================
// Token Interface
// ============================================================================

/**
 * Source location for a token
 */
export interface SourceLocation {
    /** Line number (1-indexed) */
    line: number;
    /** Column number (1-indexed) */
    column: number;
    /** Byte offset from start of source */
    offset: number;
}

/**
 * Source span (start to end location)
 */
export interface SourceSpan {
    start: SourceLocation;
    end: SourceLocation;
}

/**
 * A token produced by the lexer
 */
export interface Token {
    type: TokenType;
    value: string;
    span: SourceSpan;
}

// ============================================================================
// Keyword Mapping
// ============================================================================

/**
 * Maps keyword strings to their token types
 */
export const KEYWORDS: ReadonlyMap<string, TokenType> = new Map([
    // Module structure
    ['module', TokenType.MODULE],
    ['import', TokenType.IMPORT],
    ['from', TokenType.FROM],
    ['as', TokenType.AS],
    ['export', TokenType.EXPORT],

    // Type definitions
    ['type', TokenType.TYPE],
    ['entity', TokenType.ENTITY],
    ['enum', TokenType.ENUM],
    ['struct', TokenType.STRUCT],

    // Transaction definitions
    ['transaction', TokenType.TRANSACTION],
    ['param', TokenType.PARAM],
    ['require', TokenType.REQUIRE],
    ['ensure', TokenType.ENSURE],
    ['emit', TokenType.EMIT],
    ['let', TokenType.LET],
    ['set', TokenType.SET],
    ['delete', TokenType.DELETE],
    ['if', TokenType.IF],
    ['else', TokenType.ELSE],
    ['for', TokenType.FOR],
    ['in', TokenType.IN],
    ['while', TokenType.WHILE],
    ['break', TokenType.BREAK],
    ['continue', TokenType.CONTINUE],
    ['return', TokenType.RETURN],

    // Events
    ['event', TokenType.EVENT],

    // Invariants
    ['invariant', TokenType.INVARIANT],

    // Access control
    ['public', TokenType.PUBLIC],
    ['private', TokenType.PRIVATE],

    // State
    ['state', TokenType.STATE],
    ['get', TokenType.GET],
    ['exists', TokenType.EXISTS],

    // Types
    ['Address', TokenType.ADDRESS],
    ['UInt', TokenType.UINT],
    ['Int', TokenType.INT],
    ['Bool', TokenType.BOOL],
    ['String', TokenType.STRING_TYPE],
    ['Bytes', TokenType.BYTES_TYPE],
    ['Fixed', TokenType.FIXED],
    ['List', TokenType.LIST],
    ['Map', TokenType.MAP],
    ['Optional', TokenType.OPTIONAL],

    // Literals
    ['true', TokenType.TRUE],
    ['false', TokenType.FALSE],

    // Context
    ['caller', TokenType.CALLER],
    ['block', TokenType.BLOCK],
    ['this', TokenType.THIS],

    // Logical operators (as keywords)
    ['and', TokenType.AND],
    ['or', TokenType.OR],
    ['not', TokenType.NOT],
]);

// ============================================================================
// Token Utilities
// ============================================================================

/**
 * Creates a token
 */
export function createToken(
    type: TokenType,
    value: string,
    start: SourceLocation,
    end: SourceLocation
): Token {
    return { type, value, span: { start, end } };
}

/**
 * Checks if a token is a keyword
 */
export function isKeyword(value: string): boolean {
    return KEYWORDS.has(value);
}

/**
 * Gets the keyword token type, or IDENTIFIER if not a keyword
 */
export function getKeywordOrIdentifier(value: string): TokenType {
    return KEYWORDS.get(value) ?? TokenType.IDENTIFIER;
}

/**
 * Checks if a character is a valid identifier start
 */
export function isIdentifierStart(char: string): boolean {
    return /^[a-zA-Z_]$/.test(char);
}

/**
 * Checks if a character is a valid identifier part
 */
export function isIdentifierPart(char: string): boolean {
    return /^[a-zA-Z0-9_]$/.test(char);
}

/**
 * Checks if a character is a digit
 */
export function isDigit(char: string): boolean {
    return /^[0-9]$/.test(char);
}

/**
 * Checks if a character is a hex digit
 */
export function isHexDigit(char: string): boolean {
    return /^[0-9a-fA-F]$/.test(char);
}

/**
 * Checks if a character is whitespace (not newline)
 */
export function isWhitespace(char: string): boolean {
    return char === ' ' || char === '\t' || char === '\r';
}
