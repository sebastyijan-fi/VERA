/**
 * VERA DSL Lexer - Public API
 */

export {
    TokenType,
    type Token,
    type SourceLocation,
    type SourceSpan,
    KEYWORDS,
    createToken,
    isKeyword,
    getKeywordOrIdentifier,
    isIdentifierStart,
    isIdentifierPart,
    isDigit,
    isHexDigit,
    isWhitespace,
} from './tokens.js';

export { Lexer, LexerError, tokenize } from './lexer.js';
