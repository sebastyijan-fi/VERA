/**
 * VERA DSL Lexer
 *
 * Tokenizes VERA DSL source code into a stream of tokens.
 * Supports all VERA language constructs including operators,
 * keywords, identifiers, literals, and comments.
 */

import {
    type Token,
    type SourceLocation,
    TokenType,
    KEYWORDS,
    createToken,
    isIdentifierStart,
    isIdentifierPart,
    isDigit,
    isHexDigit,
} from './tokens.js';

// ============================================================================
// Lexer Error
// ============================================================================

export class LexerError extends Error {
    constructor(
        message: string,
        public readonly location: SourceLocation,
        public readonly source: string
    ) {
        super(`${message} at line ${location.line}, column ${location.column}`);
        this.name = 'LexerError';
    }
}

// ============================================================================
// Lexer Class
// ============================================================================

/**
 * Lexer for VERA DSL source code
 */
export class Lexer {
    private readonly source: string;
    private pos = 0;
    private line = 1;
    private column = 1;
    private readonly tokens: Token[] = [];

    constructor(source: string) {
        this.source = source;
    }

    /**
     * Tokenizes the entire source and returns all tokens
     */
    tokenize(): Token[] {
        while (!this.isAtEnd()) {
            this.scanToken();
        }

        // Add EOF token
        this.tokens.push(
            createToken(TokenType.EOF, '', this.location(), this.location())
        );

        return this.tokens;
    }

    // ============================================================================
    // Scanning
    // ============================================================================

    private scanToken(): void {
        const start = this.location();
        const char = this.advance();

        switch (char) {
            // Single-character tokens
            case '(':
                this.addToken(TokenType.LPAREN, char, start);
                break;
            case ')':
                this.addToken(TokenType.RPAREN, char, start);
                break;
            case '{':
                this.addToken(TokenType.LBRACE, char, start);
                break;
            case '}':
                this.addToken(TokenType.RBRACE, char, start);
                break;
            case '[':
                this.addToken(TokenType.LBRACKET, char, start);
                break;
            case ']':
                this.addToken(TokenType.RBRACKET, char, start);
                break;
            case ',':
                this.addToken(TokenType.COMMA, char, start);
                break;
            case ';':
                this.addToken(TokenType.SEMICOLON, char, start);
                break;
            case '?':
                this.addToken(TokenType.QUESTION, char, start);
                break;

            // Potentially multi-character tokens
            case ':':
                if (this.match(':')) {
                    this.addToken(TokenType.DOUBLE_COLON, '::', start);
                } else {
                    this.addToken(TokenType.COLON, char, start);
                }
                break;
            case '.':
                this.addToken(TokenType.DOT, char, start);
                break;
            case '+':
                if (this.match('=')) {
                    this.addToken(TokenType.PLUS_ASSIGN, '+=', start);
                } else {
                    this.addToken(TokenType.PLUS, char, start);
                }
                break;
            case '-':
                if (this.match('=')) {
                    this.addToken(TokenType.MINUS_ASSIGN, '-=', start);
                } else if (this.match('>')) {
                    this.addToken(TokenType.ARROW, '->', start);
                } else {
                    this.addToken(TokenType.MINUS, char, start);
                }
                break;
            case '*':
                this.addToken(TokenType.STAR, char, start);
                break;
            case '%':
                this.addToken(TokenType.PERCENT, char, start);
                break;
            case '/':
                if (this.match('/')) {
                    this.scanLineComment();
                } else if (this.match('*')) {
                    this.scanBlockComment(start);
                } else {
                    this.addToken(TokenType.SLASH, char, start);
                }
                break;
            case '=':
                if (this.match('=')) {
                    this.addToken(TokenType.EQ, '==', start);
                } else {
                    this.addToken(TokenType.ASSIGN, char, start);
                }
                break;
            case '!':
                if (this.match('=')) {
                    this.addToken(TokenType.NEQ, '!=', start);
                } else {
                    this.addToken(TokenType.NOT, char, start);
                }
                break;
            case '<':
                if (this.match('=')) {
                    this.addToken(TokenType.LTE, '<=', start);
                } else {
                    this.addToken(TokenType.LT, char, start);
                }
                break;
            case '>':
                if (this.match('=')) {
                    this.addToken(TokenType.GTE, '>=', start);
                } else {
                    this.addToken(TokenType.GT, char, start);
                }
                break;
            case '&':
                if (this.match('&')) {
                    this.addToken(TokenType.AND, '&&', start);
                } else {
                    this.error('Unexpected character', start);
                }
                break;
            case '|':
                if (this.match('|')) {
                    this.addToken(TokenType.OR, '||', start);
                } else {
                    this.error('Unexpected character', start);
                }
                break;

            // Whitespace
            case ' ':
            case '\t':
            case '\r':
                // Ignore whitespace
                break;
            case '\n':
                this.line++;
                this.column = 1;
                break;

            // String literals
            case '"':
                this.scanString(start);
                break;

            // Hex bytes literal
            case '0':
                if (this.peek() === 'x' || this.peek() === 'X') {
                    this.advance(); // consume 'x'
                    this.scanHexLiteral(start);
                } else {
                    this.scanNumber(start, char);
                }
                break;

            default:
                if (isDigit(char)) {
                    this.scanNumber(start, char);
                } else if (isIdentifierStart(char)) {
                    this.scanIdentifier(start, char);
                } else {
                    this.error(`Unexpected character: ${char}`, start);
                }
        }
    }

    // ============================================================================
    // Literal Scanning
    // ============================================================================

    private scanString(start: SourceLocation): void {
        let value = '';

        while (!this.isAtEnd() && this.peek() !== '"') {
            if (this.peek() === '\n') {
                this.error('Unterminated string', start);
            }
            if (this.peek() === '\\') {
                this.advance(); // consume backslash
                const escape = this.advance();
                switch (escape) {
                    case 'n':
                        value += '\n';
                        break;
                    case 't':
                        value += '\t';
                        break;
                    case 'r':
                        value += '\r';
                        break;
                    case '"':
                        value += '"';
                        break;
                    case '\\':
                        value += '\\';
                        break;
                    default:
                        this.error(`Invalid escape sequence: \\${escape}`, start);
                }
            } else {
                value += this.advance();
            }
        }

        if (this.isAtEnd()) {
            this.error('Unterminated string', start);
        }

        this.advance(); // consume closing quote
        this.addToken(TokenType.STRING, value, start);
    }

    private scanNumber(start: SourceLocation, firstChar: string): void {
        let value = firstChar;

        while (!this.isAtEnd() && isDigit(this.peek())) {
            value += this.advance();
        }

        // Check for underscore separators
        while (!this.isAtEnd() && (isDigit(this.peek()) || this.peek() === '_')) {
            const char = this.advance();
            if (char !== '_') {
                value += char;
            }
        }

        this.addToken(TokenType.INTEGER, value, start);
    }

    private scanHexLiteral(start: SourceLocation): void {
        let value = '0x';

        while (!this.isAtEnd() && (isHexDigit(this.peek()) || this.peek() === '_')) {
            const char = this.advance();
            if (char !== '_') {
                value += char;
            }
        }

        if (value === '0x') {
            this.error('Invalid hex literal', start);
        }

        this.addToken(TokenType.BYTES, value, start);
    }

    private scanIdentifier(start: SourceLocation, firstChar: string): void {
        let value = firstChar;

        while (!this.isAtEnd() && isIdentifierPart(this.peek())) {
            value += this.advance();
        }

        // Check if it's a keyword
        const type = KEYWORDS.get(value) ?? TokenType.IDENTIFIER;
        this.addToken(type, value, start);
    }

    // ============================================================================
    // Comment Scanning
    // ============================================================================

    private scanLineComment(): void {
        // Consume until end of line
        while (!this.isAtEnd() && this.peek() !== '\n') {
            this.advance();
        }
        // Don't add comment tokens (skip them)
    }

    private scanBlockComment(start: SourceLocation): void {
        let depth = 1;

        while (!this.isAtEnd() && depth > 0) {
            if (this.peek() === '/' && this.peekNext() === '*') {
                this.advance();
                this.advance();
                depth++;
            } else if (this.peek() === '*' && this.peekNext() === '/') {
                this.advance();
                this.advance();
                depth--;
            } else {
                if (this.peek() === '\n') {
                    this.line++;
                    this.column = 0;
                }
                this.advance();
            }
        }

        if (depth > 0) {
            this.error('Unterminated block comment', start);
        }
    }

    // ============================================================================
    // Helper Methods
    // ============================================================================

    private isAtEnd(): boolean {
        return this.pos >= this.source.length;
    }

    private peek(): string {
        if (this.isAtEnd()) return '\0';
        return this.source[this.pos]!;
    }

    private peekNext(): string {
        if (this.pos + 1 >= this.source.length) return '\0';
        return this.source[this.pos + 1]!;
    }

    private advance(): string {
        const char = this.source[this.pos]!;
        this.pos++;
        this.column++;
        return char;
    }

    private match(expected: string): boolean {
        if (this.isAtEnd()) return false;
        if (this.source[this.pos] !== expected) return false;
        this.pos++;
        this.column++;
        return true;
    }

    private location(): SourceLocation {
        return {
            line: this.line,
            column: this.column,
            offset: this.pos,
        };
    }

    private addToken(type: TokenType, value: string, start: SourceLocation): void {
        this.tokens.push(createToken(type, value, start, this.location()));
    }

    private error(message: string, location: SourceLocation): never {
        throw new LexerError(message, location, this.source);
    }
}

// ============================================================================
// Convenience Function
// ============================================================================

/**
 * Tokenizes source code and returns all tokens
 */
export function tokenize(source: string): Token[] {
    return new Lexer(source).tokenize();
}
