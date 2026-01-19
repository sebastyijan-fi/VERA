/**
 * Lexer Tests
 */
import { describe, it, expect } from 'vitest';
import { tokenize, TokenType, type Token, LexerError } from '../src/lexer/index.js';

function getTokenTypes(source: string): TokenType[] {
    return tokenize(source).map((t) => t.type);
}

function getTokenValues(source: string): string[] {
    return tokenize(source).map((t) => t.value);
}

describe('Lexer', () => {
    describe('Basic Tokens', () => {
        it('tokenizes empty input', () => {
            const tokens = tokenize('');
            expect(tokens).toHaveLength(1);
            expect(tokens[0]?.type).toBe(TokenType.EOF);
        });

        it('tokenizes single-character delimiters', () => {
            const types = getTokenTypes('(){},.:;[]');
            expect(types).toContain(TokenType.LPAREN);
            expect(types).toContain(TokenType.RPAREN);
            expect(types).toContain(TokenType.LBRACE);
            expect(types).toContain(TokenType.RBRACE);
            expect(types).toContain(TokenType.COMMA);
            expect(types).toContain(TokenType.DOT);
            expect(types).toContain(TokenType.COLON);
            expect(types).toContain(TokenType.SEMICOLON);
        });

        it('tokenizes two-character operators', () => {
            expect(getTokenTypes('==')).toContain(TokenType.EQ);
            expect(getTokenTypes('!=')).toContain(TokenType.NEQ);
            expect(getTokenTypes('<=')).toContain(TokenType.LTE);
            expect(getTokenTypes('>=')).toContain(TokenType.GTE);
            expect(getTokenTypes('&&')).toContain(TokenType.AND);
            expect(getTokenTypes('||')).toContain(TokenType.OR);
            expect(getTokenTypes('->')).toContain(TokenType.ARROW);
            expect(getTokenTypes('::')).toContain(TokenType.DOUBLE_COLON);
            expect(getTokenTypes('+=')).toContain(TokenType.PLUS_ASSIGN);
            expect(getTokenTypes('-=')).toContain(TokenType.MINUS_ASSIGN);
        });

        it('tokenizes arithmetic operators', () => {
            const types = getTokenTypes('+ - * / %');
            expect(types).toContain(TokenType.PLUS);
            expect(types).toContain(TokenType.MINUS);
            expect(types).toContain(TokenType.STAR);
            expect(types).toContain(TokenType.SLASH);
            expect(types).toContain(TokenType.PERCENT);
        });
    });

    describe('Keywords', () => {
        it('recognizes module keywords', () => {
            expect(getTokenTypes('module')).toContain(TokenType.MODULE);
            expect(getTokenTypes('import')).toContain(TokenType.IMPORT);
            expect(getTokenTypes('from')).toContain(TokenType.FROM);
            expect(getTokenTypes('as')).toContain(TokenType.AS);
            expect(getTokenTypes('export')).toContain(TokenType.EXPORT);
        });

        it('recognizes type keywords', () => {
            expect(getTokenTypes('entity')).toContain(TokenType.ENTITY);
            expect(getTokenTypes('transaction')).toContain(TokenType.TRANSACTION);
            expect(getTokenTypes('event')).toContain(TokenType.EVENT);
            expect(getTokenTypes('type')).toContain(TokenType.TYPE);
        });

        it('recognizes statement keywords', () => {
            expect(getTokenTypes('let')).toContain(TokenType.LET);
            expect(getTokenTypes('set')).toContain(TokenType.SET);
            expect(getTokenTypes('if')).toContain(TokenType.IF);
            expect(getTokenTypes('else')).toContain(TokenType.ELSE);
            expect(getTokenTypes('for')).toContain(TokenType.FOR);
            expect(getTokenTypes('while')).toContain(TokenType.WHILE);
            expect(getTokenTypes('require')).toContain(TokenType.REQUIRE);
            expect(getTokenTypes('ensure')).toContain(TokenType.ENSURE);
        });

        it('recognizes type name keywords', () => {
            expect(getTokenTypes('Address')).toContain(TokenType.ADDRESS);
            expect(getTokenTypes('UInt')).toContain(TokenType.UINT);
            expect(getTokenTypes('Int')).toContain(TokenType.INT);
            expect(getTokenTypes('Bool')).toContain(TokenType.BOOL);
            expect(getTokenTypes('String')).toContain(TokenType.STRING_TYPE);
            expect(getTokenTypes('Bytes')).toContain(TokenType.BYTES_TYPE);
        });
    });

    describe('Literals', () => {
        it('tokenizes integer literals', () => {
            const tokens = tokenize('123 0 999_999');
            expect(tokens[0]?.type).toBe(TokenType.INTEGER);
            expect(tokens[0]?.value).toBe('123');
            expect(tokens[1]?.type).toBe(TokenType.INTEGER);
            expect(tokens[1]?.value).toBe('0');
        });

        it('tokenizes string literals', () => {
            const tokens = tokenize('"hello" "world"');
            expect(tokens[0]?.type).toBe(TokenType.STRING);
            expect(tokens[0]?.value).toBe('hello');
            expect(tokens[1]?.type).toBe(TokenType.STRING);
            expect(tokens[1]?.value).toBe('world');
        });

        it('tokenizes string escapes', () => {
            const tokens = tokenize('"hello\\nworld"');
            expect(tokens[0]?.value).toBe('hello\nworld');
        });

        it('tokenizes boolean literals', () => {
            expect(getTokenTypes('true false')).toContain(TokenType.TRUE);
            expect(getTokenTypes('true false')).toContain(TokenType.FALSE);
        });

        it('tokenizes hex bytes literals', () => {
            const tokens = tokenize('0xDEADBEEF 0x123abc');
            expect(tokens[0]?.type).toBe(TokenType.BYTES);
            expect(tokens[0]?.value).toBe('0xDEADBEEF');
        });
    });

    describe('Identifiers', () => {
        it('tokenizes identifiers', () => {
            const tokens = tokenize('myVar _private camelCase');
            expect(tokens[0]?.type).toBe(TokenType.IDENTIFIER);
            expect(tokens[0]?.value).toBe('myVar');
            expect(tokens[1]?.type).toBe(TokenType.IDENTIFIER);
            expect(tokens[2]?.type).toBe(TokenType.IDENTIFIER);
        });

        it('distinguishes keywords from identifiers', () => {
            const tokens = tokenize('module myModule');
            expect(tokens[0]?.type).toBe(TokenType.MODULE);
            expect(tokens[1]?.type).toBe(TokenType.IDENTIFIER);
        });
    });

    describe('Comments', () => {
        it('ignores line comments', () => {
            const tokens = tokenize('let x // this is a comment\nlet y');
            const identifiers = tokens.filter((t) => t.type === TokenType.IDENTIFIER);
            expect(identifiers).toHaveLength(2);
        });

        it('ignores block comments', () => {
            const tokens = tokenize('let /* inline */ x');
            expect(tokens).toHaveLength(3); // let, x, EOF
        });
    });

    describe('Source Locations', () => {
        it('tracks line and column', () => {
            const tokens = tokenize('let\nx');
            expect(tokens[0]?.span.start.line).toBe(1);
            expect(tokens[1]?.span.start.line).toBe(2);
        });
    });

    describe('Error Handling', () => {
        it('throws on unterminated string', () => {
            expect(() => tokenize('"unterminated')).toThrow(LexerError);
        });
    });
});
