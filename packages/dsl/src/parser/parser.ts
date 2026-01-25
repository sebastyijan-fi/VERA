/**
 * VERA DSL Parser
 *
 * Recursive descent parser for VERA DSL.
 * Converts token stream to AST.
 */

import {
    type Token,
    type SourceLocation,
    TokenType,
    Lexer,
} from '../lexer/index.js';
import type {
    Module,
    Declaration,
    Statement,
    Expression,
    TypeNode,
    ImportStatement,
    TransactionDeclaration,
    EntityDeclaration,
    TypeDeclaration,
    EventDeclaration,
    InvariantDeclaration,
    ParamDefinition,
    FieldDefinition,
    LetStatement,
    SetStatement,
    IfStatement,
    ForStatement,
    WhileStatement,
    RequireStatement,
    EnsureStatement,
    EmitStatement,
    ReturnStatement,
} from '../ast/nodes.js';

// ============================================================================
// Parser Error
// ============================================================================

export class ParserError extends Error {
    constructor(
        message: string,
        public readonly token: Token,
        public readonly expected?: string
    ) {
        super(
            `${message} at line ${token.span.start.line}, column ${token.span.start.column}` +
            (expected ? ` (expected ${expected})` : '')
        );
        this.name = 'ParserError';
    }
}

// ============================================================================
// Parser Class
// ============================================================================

export class Parser {
    private readonly tokens: Token[];
    private current = 0;

    constructor(tokens: Token[]) {
        this.tokens = tokens;
    }

    /**
     * Parses a complete module
     */
    parseModule(): Module {
        const start = this.peek().span.start;

        // Parse module declaration
        this.consume(TokenType.MODULE, 'module');
        const name = this.consume(TokenType.IDENTIFIER, 'module name').value;

        // Optional semicolon or newline
        this.match(TokenType.SEMICOLON);

        // Parse imports
        const imports: ImportStatement[] = [];
        while (this.check(TokenType.IMPORT)) {
            imports.push(this.parseImport());
        }

        // Parse declarations
        const declarations: Declaration[] = [];
        while (!this.check(TokenType.EOF)) {
            declarations.push(this.parseDeclaration());
        }

        const end = this.previous().span.end;

        return {
            kind: 'Module',
            name,
            imports,
            declarations,
            span: { start, end },
        };
    }

    // ============================================================================
    // Import Parsing
    // ============================================================================

    private parseImport(): ImportStatement {
        const start = this.peek().span.start;

        this.consume(TokenType.IMPORT, 'import');

        const items: { name: string; alias?: string | undefined }[] = [];

        // Parse import list
        this.consume(TokenType.LBRACE, '{');
        do {
            const name = this.consume(TokenType.IDENTIFIER, 'identifier').value;
            const item: { name: string; alias?: string | undefined } = { name };
            if (this.match(TokenType.AS)) {
                item.alias = this.consume(TokenType.IDENTIFIER, 'alias').value;
            }
            items.push(item);
        } while (this.match(TokenType.COMMA));
        this.consume(TokenType.RBRACE, '}');

        this.consume(TokenType.FROM, 'from');
        const from = this.consume(TokenType.STRING, 'module path').value;

        this.match(TokenType.SEMICOLON);

        const end = this.previous().span.end;

        return {
            kind: 'ImportStatement',
            items,
            from,
            span: { start, end },
        };
    }

    // ============================================================================
    // Declaration Parsing
    // ============================================================================

    private parseDeclaration(): Declaration {
        // Check visibility modifier
        let visibility: 'public' | 'private' = 'private';
        if (this.match(TokenType.PUBLIC)) {
            visibility = 'public';
        } else if (this.match(TokenType.PRIVATE)) {
            visibility = 'private';
        }

        if (this.check(TokenType.ENTITY)) {
            return this.parseEntityDeclaration(visibility);
        }
        if (this.check(TokenType.TRANSACTION)) {
            return this.parseTransactionDeclaration(visibility);
        }
        if (this.check(TokenType.TYPE)) {
            return this.parseTypeDeclaration(visibility);
        }
        if (this.check(TokenType.EVENT)) {
            return this.parseEventDeclaration();
        }
        if (this.check(TokenType.INVARIANT)) {
            return this.parseInvariantDeclaration();
        }

        throw new ParserError(
            `Unexpected token: ${this.peek().value}`,
            this.peek(),
            'declaration'
        );
    }

    private parseEntityDeclaration(visibility: 'public' | 'private'): EntityDeclaration {
        const start = this.previous().span.start;

        this.consume(TokenType.ENTITY, 'entity');
        const name = this.consume(TokenType.IDENTIFIER, 'entity name').value;

        // Parse key type
        this.consume(TokenType.LBRACKET, '[');
        const keyType = this.parseType();
        this.consume(TokenType.RBRACKET, ']');

        // Parse fields
        this.consume(TokenType.LBRACE, '{');
        const fields: FieldDefinition[] = [];
        while (!this.check(TokenType.RBRACE) && !this.check(TokenType.EOF)) {
            fields.push(this.parseFieldDefinition());
        }
        this.consume(TokenType.RBRACE, '}');

        const end = this.previous().span.end;

        return {
            kind: 'EntityDeclaration',
            name,
            visibility,
            keyType,
            fields,
            span: { start, end },
        };
    }

    private parseTransactionDeclaration(visibility: 'public' | 'private'): TransactionDeclaration {
        const start = this.previous().span.start;

        this.consume(TokenType.TRANSACTION, 'transaction');
        const name = this.consume(TokenType.IDENTIFIER, 'transaction name').value;

        // Parse parameters
        this.consume(TokenType.LPAREN, '(');
        const params: ParamDefinition[] = [];
        if (!this.check(TokenType.RPAREN)) {
            do {
                params.push(this.parseParamDefinition());
            } while (this.match(TokenType.COMMA));
        }
        this.consume(TokenType.RPAREN, ')');

        // Parse body
        this.consume(TokenType.LBRACE, '{');
        const body: Statement[] = [];
        while (!this.check(TokenType.RBRACE) && !this.check(TokenType.EOF)) {
            body.push(this.parseStatement());
        }
        this.consume(TokenType.RBRACE, '}');

        const end = this.previous().span.end;

        return {
            kind: 'TransactionDeclaration',
            name,
            visibility,
            params,
            body,
            span: { start, end },
        };
    }

    private parseTypeDeclaration(visibility: 'public' | 'private'): TypeDeclaration {
        const start = this.previous().span.start;

        this.consume(TokenType.TYPE, 'type');
        const name = this.consume(TokenType.IDENTIFIER, 'type name').value;

        // Check for struct, enum, or type alias
        if (this.match(TokenType.ASSIGN)) {
            // Type alias
            const target = this.parseType();
            this.match(TokenType.SEMICOLON);

            return {
                kind: 'TypeDeclaration',
                name,
                visibility,
                definition: { type: 'alias', target },
                span: { start, end: this.previous().span.end },
            };
        }

        if (this.match(TokenType.STRUCT) || this.check(TokenType.LBRACE)) {
            // Struct
            this.consume(TokenType.LBRACE, '{');
            const fields: FieldDefinition[] = [];
            while (!this.check(TokenType.RBRACE) && !this.check(TokenType.EOF)) {
                fields.push(this.parseFieldDefinition());
            }
            this.consume(TokenType.RBRACE, '}');

            return {
                kind: 'TypeDeclaration',
                name,
                visibility,
                definition: { type: 'struct', fields },
                span: { start, end: this.previous().span.end },
            };
        }

        if (this.match(TokenType.ENUM)) {
            // Enum
            this.consume(TokenType.LBRACE, '{');
            const variants: string[] = [];
            do {
                variants.push(this.consume(TokenType.IDENTIFIER, 'variant').value);
            } while (this.match(TokenType.COMMA));
            this.consume(TokenType.RBRACE, '}');

            return {
                kind: 'TypeDeclaration',
                name,
                visibility,
                definition: { type: 'enum', variants },
                span: { start, end: this.previous().span.end },
            };
        }

        throw new ParserError('Expected type definition', this.peek());
    }

    private parseEventDeclaration(): EventDeclaration {
        const start = this.peek().span.start;

        this.consume(TokenType.EVENT, 'event');
        const name = this.consume(TokenType.IDENTIFIER, 'event name').value;

        this.consume(TokenType.LBRACE, '{');
        const fields: FieldDefinition[] = [];
        while (!this.check(TokenType.RBRACE) && !this.check(TokenType.EOF)) {
            fields.push(this.parseFieldDefinition());
        }
        this.consume(TokenType.RBRACE, '}');

        return {
            kind: 'EventDeclaration',
            name,
            fields,
            span: { start, end: this.previous().span.end },
        };
    }

    private parseInvariantDeclaration(): InvariantDeclaration {
        const start = this.peek().span.start;

        this.consume(TokenType.INVARIANT, 'invariant');
        const name = this.consume(TokenType.IDENTIFIER, 'invariant name').value;

        this.consume(TokenType.LBRACE, '{');
        const condition = this.parseExpression();
        this.consume(TokenType.RBRACE, '}');

        return {
            kind: 'InvariantDeclaration',
            name,
            condition,
            span: { start, end: this.previous().span.end },
        };
    }

    private parseFieldDefinition(): FieldDefinition {
        const start = this.peek().span.start;

        const name = this.consume(TokenType.IDENTIFIER, 'field name').value;
        this.consume(TokenType.COLON, ':');
        const type = this.parseType();

        let defaultValue: Expression | undefined;
        if (this.match(TokenType.ASSIGN)) {
            defaultValue = this.parseExpression();
        }

        this.match(TokenType.COMMA);

        return {
            kind: 'FieldDefinition',
            name,
            type,
            defaultValue,
            span: { start, end: this.previous().span.end },
        };
    }

    private parseParamDefinition(): ParamDefinition {
        const start = this.peek().span.start;

        const name = this.consume(TokenType.IDENTIFIER, 'parameter name').value;
        this.consume(TokenType.COLON, ':');
        const type = this.parseType();

        let defaultValue: Expression | undefined;
        if (this.match(TokenType.ASSIGN)) {
            defaultValue = this.parseExpression();
        }

        return {
            kind: 'ParamDefinition',
            name,
            type,
            defaultValue,
            span: { start, end: this.previous().span.end },
        };
    }

    // ============================================================================
    // Type Parsing
    // ============================================================================

    private parseType(): TypeNode {
        const start = this.peek().span.start;

        // Primitive types
        if (this.match(TokenType.UINT)) {
            return this.parsePrimitiveType('UInt', start);
        }
        if (this.match(TokenType.INT)) {
            return this.parsePrimitiveType('Int', start);
        }
        if (this.match(TokenType.BOOL)) {
            return { kind: 'PrimitiveType', name: 'Bool', span: { start, end: this.previous().span.end } };
        }
        if (this.match(TokenType.STRING_TYPE)) {
            return { kind: 'PrimitiveType', name: 'String', span: { start, end: this.previous().span.end } };
        }
        if (this.match(TokenType.BYTES_TYPE)) {
            return { kind: 'PrimitiveType', name: 'Bytes', span: { start, end: this.previous().span.end } };
        }
        if (this.match(TokenType.ADDRESS)) {
            return { kind: 'AddressType', span: { start, end: this.previous().span.end } };
        }

        // Fixed point
        if (this.match(TokenType.FIXED)) {
            return this.parseFixedType(start);
        }

        // Collection types
        if (this.match(TokenType.LIST)) {
            return this.parseListType(start);
        }
        if (this.match(TokenType.MAP)) {
            return this.parseMapType(start);
        }
        if (this.match(TokenType.OPTIONAL)) {
            return this.parseOptionalType(start);
        }

        // Named type (user-defined)
        if (this.check(TokenType.IDENTIFIER)) {
            const name = this.advance().value;
            let module: string | undefined;

            if (this.match(TokenType.DOUBLE_COLON)) {
                module = name;
                const typeName = this.consume(TokenType.IDENTIFIER, 'type name').value;
                return { kind: 'NamedType', module, name: typeName, span: { start, end: this.previous().span.end } };
            }

            return { kind: 'NamedType', name, span: { start, end: this.previous().span.end } };
        }

        throw new ParserError('Expected type', this.peek());
    }

    private parsePrimitiveType(name: 'UInt' | 'Int', start: SourceLocation): TypeNode {
        let bits: number | undefined;

        if (this.match(TokenType.LT)) {
            const bitsToken = this.consume(TokenType.INTEGER, 'bit width');
            bits = parseInt(bitsToken.value, 10);
            this.consume(TokenType.GT, '>');
        }

        return { kind: 'PrimitiveType', name, bits, span: { start, end: this.previous().span.end } };
    }

    private parseFixedType(start: SourceLocation): TypeNode {
        this.consume(TokenType.LT, '<');
        const precisionToken = this.consume(TokenType.INTEGER, 'precision');
        const precision = parseInt(precisionToken.value, 10);
        this.consume(TokenType.COMMA, ',');
        const scaleToken = this.consume(TokenType.INTEGER, 'scale');
        const scale = parseInt(scaleToken.value, 10);
        this.consume(TokenType.GT, '>');

        return { kind: 'FixedType', precision, scale, span: { start, end: this.previous().span.end } };
    }

    private parseListType(start: SourceLocation): TypeNode {
        this.consume(TokenType.LT, '<');
        const elementType = this.parseType();

        let maxLength: number | undefined;
        if (this.match(TokenType.COMMA)) {
            const lengthToken = this.consume(TokenType.INTEGER, 'max length');
            maxLength = parseInt(lengthToken.value, 10);
        }

        this.consume(TokenType.GT, '>');

        return { kind: 'ListType', elementType, maxLength, span: { start, end: this.previous().span.end } };
    }

    private parseMapType(start: SourceLocation): TypeNode {
        this.consume(TokenType.LT, '<');
        const keyType = this.parseType();
        this.consume(TokenType.COMMA, ',');
        const valueType = this.parseType();
        this.consume(TokenType.GT, '>');

        return { kind: 'MapType', keyType, valueType, span: { start, end: this.previous().span.end } };
    }

    private parseOptionalType(start: SourceLocation): TypeNode {
        this.consume(TokenType.LT, '<');
        const innerType = this.parseType();
        this.consume(TokenType.GT, '>');

        return { kind: 'OptionalType', innerType, span: { start, end: this.previous().span.end } };
    }

    // ============================================================================
    // Statement Parsing
    // ============================================================================

    private parseStatement(): Statement {
        if (this.check(TokenType.LET)) {
            return this.parseLetStatement();
        }
        if (this.check(TokenType.SET)) {
            return this.parseSetStatement();
        }
        if (this.check(TokenType.DELETE)) {
            return this.parseDeleteStatement();
        }
        if (this.check(TokenType.IF)) {
            return this.parseIfStatement();
        }
        if (this.check(TokenType.FOR)) {
            return this.parseForStatement();
        }
        if (this.check(TokenType.WHILE)) {
            return this.parseWhileStatement();
        }
        if (this.check(TokenType.REQUIRE)) {
            return this.parseRequireStatement();
        }
        if (this.check(TokenType.ENSURE)) {
            return this.parseEnsureStatement();
        }
        if (this.check(TokenType.EMIT)) {
            return this.parseEmitStatement();
        }
        if (this.check(TokenType.RETURN)) {
            return this.parseReturnStatement();
        }
        if (this.check(TokenType.BREAK)) {
            this.advance();
            this.match(TokenType.SEMICOLON);
            return { kind: 'BreakStatement', span: this.previous().span };
        }
        if (this.check(TokenType.CONTINUE)) {
            this.advance();
            this.match(TokenType.SEMICOLON);
            return { kind: 'ContinueStatement', span: this.previous().span };
        }

        // Expression statement
        const start = this.peek().span.start;
        const expression = this.parseExpression();
        this.match(TokenType.SEMICOLON);

        return {
            kind: 'ExpressionStatement',
            expression,
            span: { start, end: this.previous().span.end },
        };
    }

    private parseLetStatement(): LetStatement {
        const start = this.peek().span.start;

        this.consume(TokenType.LET, 'let');
        const name = this.consume(TokenType.IDENTIFIER, 'variable name').value;

        let typeAnnotation: TypeNode | undefined;
        if (this.match(TokenType.COLON)) {
            typeAnnotation = this.parseType();
        }

        this.consume(TokenType.ASSIGN, '=');
        const initializer = this.parseExpression();
        this.match(TokenType.SEMICOLON);

        return {
            kind: 'LetStatement',
            name,
            typeAnnotation,
            initializer,
            span: { start, end: this.previous().span.end },
        };
    }

    private parseSetStatement(): SetStatement {
        const start = this.peek().span.start;

        this.consume(TokenType.SET, 'set');
        const target = this.parseExpression();
        this.consume(TokenType.ASSIGN, '=');
        const value = this.parseExpression();
        this.match(TokenType.SEMICOLON);

        return {
            kind: 'SetStatement',
            target,
            value,
            span: { start, end: this.previous().span.end },
        };
    }

    private parseDeleteStatement(): Statement {
        const start = this.peek().span.start;

        this.consume(TokenType.DELETE, 'delete');
        const target = this.parseExpression();
        this.match(TokenType.SEMICOLON);

        return {
            kind: 'DeleteStatement',
            target,
            span: { start, end: this.previous().span.end },
        };
    }

    private parseIfStatement(): IfStatement {
        const start = this.peek().span.start;

        this.consume(TokenType.IF, 'if');
        const condition = this.parseExpression();

        this.consume(TokenType.LBRACE, '{');
        const consequent: Statement[] = [];
        while (!this.check(TokenType.RBRACE) && !this.check(TokenType.EOF)) {
            consequent.push(this.parseStatement());
        }
        this.consume(TokenType.RBRACE, '}');

        let alternate: Statement[] | IfStatement | undefined;
        if (this.match(TokenType.ELSE)) {
            if (this.check(TokenType.IF)) {
                alternate = this.parseIfStatement();
            } else {
                this.consume(TokenType.LBRACE, '{');
                alternate = [];
                while (!this.check(TokenType.RBRACE) && !this.check(TokenType.EOF)) {
                    alternate.push(this.parseStatement());
                }
                this.consume(TokenType.RBRACE, '}');
            }
        }

        return {
            kind: 'IfStatement',
            condition,
            consequent,
            alternate,
            span: { start, end: this.previous().span.end },
        };
    }

    private parseForStatement(): ForStatement {
        const start = this.peek().span.start;

        this.consume(TokenType.FOR, 'for');
        const variable = this.consume(TokenType.IDENTIFIER, 'variable').value;
        this.consume(TokenType.IN, 'in');
        const iterable = this.parseExpression();

        this.consume(TokenType.LBRACE, '{');
        const body: Statement[] = [];
        while (!this.check(TokenType.RBRACE) && !this.check(TokenType.EOF)) {
            body.push(this.parseStatement());
        }
        this.consume(TokenType.RBRACE, '}');

        return {
            kind: 'ForStatement',
            variable,
            iterable,
            body,
            span: { start, end: this.previous().span.end },
        };
    }

    private parseWhileStatement(): WhileStatement {
        const start = this.peek().span.start;

        this.consume(TokenType.WHILE, 'while');
        const condition = this.parseExpression();

        // Max iterations is required for bounded loops
        // Default to 1000 if not specified
        const maxIterations = 1000;

        this.consume(TokenType.LBRACE, '{');
        const body: Statement[] = [];
        while (!this.check(TokenType.RBRACE) && !this.check(TokenType.EOF)) {
            body.push(this.parseStatement());
        }
        this.consume(TokenType.RBRACE, '}');

        return {
            kind: 'WhileStatement',
            condition,
            body,
            maxIterations,
            span: { start, end: this.previous().span.end },
        };
    }

    private parseRequireStatement(): RequireStatement {
        const start = this.peek().span.start;

        this.consume(TokenType.REQUIRE, 'require');
        const condition = this.parseExpression();

        let message: string | undefined;
        if (this.match(TokenType.COMMA)) {
            message = this.consume(TokenType.STRING, 'error message').value;
        }

        this.match(TokenType.SEMICOLON);

        return {
            kind: 'RequireStatement',
            condition,
            message,
            span: { start, end: this.previous().span.end },
        };
    }

    private parseEnsureStatement(): EnsureStatement {
        const start = this.peek().span.start;

        this.consume(TokenType.ENSURE, 'ensure');
        const condition = this.parseExpression();

        let message: string | undefined;
        if (this.match(TokenType.COMMA)) {
            message = this.consume(TokenType.STRING, 'error message').value;
        }

        this.match(TokenType.SEMICOLON);

        return {
            kind: 'EnsureStatement',
            condition,
            message,
            span: { start, end: this.previous().span.end },
        };
    }

    private parseEmitStatement(): EmitStatement {
        const start = this.peek().span.start;

        this.consume(TokenType.EMIT, 'emit');
        const eventName = this.consume(TokenType.IDENTIFIER, 'event name').value;

        this.consume(TokenType.LPAREN, '(');
        const args: Expression[] = [];
        if (!this.check(TokenType.RPAREN)) {
            do {
                args.push(this.parseExpression());
            } while (this.match(TokenType.COMMA));
        }
        this.consume(TokenType.RPAREN, ')');

        this.match(TokenType.SEMICOLON);

        return {
            kind: 'EmitStatement',
            eventName,
            arguments: args,
            span: { start, end: this.previous().span.end },
        };
    }

    private parseReturnStatement(): ReturnStatement {
        const start = this.peek().span.start;

        this.consume(TokenType.RETURN, 'return');

        let value: Expression | undefined;
        if (!this.check(TokenType.SEMICOLON) && !this.check(TokenType.RBRACE)) {
            value = this.parseExpression();
        }

        this.match(TokenType.SEMICOLON);

        return {
            kind: 'ReturnStatement',
            value,
            span: { start, end: this.previous().span.end },
        };
    }

    // ============================================================================
    // Expression Parsing (Pratt Parser)
    // ============================================================================

    private parseExpression(): Expression {
        return this.parseOr();
    }

    private parseOr(): Expression {
        let left = this.parseAnd();

        while (this.match(TokenType.OR)) {
            const operator = '||';
            const right = this.parseAnd();
            left = {
                kind: 'BinaryExpr',
                operator,
                left,
                right,
                span: { start: left.span.start, end: right.span.end },
            };
        }

        return left;
    }

    private parseAnd(): Expression {
        let left = this.parseEquality();

        while (this.match(TokenType.AND)) {
            const operator = '&&';
            const right = this.parseEquality();
            left = {
                kind: 'BinaryExpr',
                operator,
                left,
                right,
                span: { start: left.span.start, end: right.span.end },
            };
        }

        return left;
    }

    private parseEquality(): Expression {
        let left = this.parseComparison();

        while (this.match(TokenType.EQ, TokenType.NEQ)) {
            const operator = this.previous().value as '==' | '!=';
            const right = this.parseComparison();
            left = {
                kind: 'BinaryExpr',
                operator,
                left,
                right,
                span: { start: left.span.start, end: right.span.end },
            };
        }

        return left;
    }

    private parseComparison(): Expression {
        let left = this.parseTerm();

        while (this.match(TokenType.LT, TokenType.GT, TokenType.LTE, TokenType.GTE)) {
            const operator = this.previous().value as '<' | '>' | '<=' | '>=';
            const right = this.parseTerm();
            left = {
                kind: 'BinaryExpr',
                operator,
                left,
                right,
                span: { start: left.span.start, end: right.span.end },
            };
        }

        return left;
    }

    private parseTerm(): Expression {
        let left = this.parseFactor();

        while (this.match(TokenType.PLUS, TokenType.MINUS)) {
            const operator = this.previous().value as '+' | '-';
            const right = this.parseFactor();
            left = {
                kind: 'BinaryExpr',
                operator,
                left,
                right,
                span: { start: left.span.start, end: right.span.end },
            };
        }

        return left;
    }

    private parseFactor(): Expression {
        let left = this.parseUnary();

        while (this.match(TokenType.STAR, TokenType.SLASH, TokenType.PERCENT)) {
            const operator = this.previous().value as '*' | '/' | '%';
            const right = this.parseUnary();
            left = {
                kind: 'BinaryExpr',
                operator,
                left,
                right,
                span: { start: left.span.start, end: right.span.end },
            };
        }

        return left;
    }

    private parseUnary(): Expression {
        if (this.match(TokenType.NOT, TokenType.MINUS)) {
            const operator = this.previous().value as '!' | '-' | 'not';
            const operand = this.parseUnary();
            return {
                kind: 'UnaryExpr',
                operator,
                operand,
                span: { start: this.previous().span.start, end: operand.span.end },
            };
        }

        return this.parseCall();
    }

    private parseCall(): Expression {
        let expr = this.parsePrimary();

        while (true) {
            if (this.match(TokenType.LPAREN)) {
                expr = this.finishCall(expr);
            } else if (this.match(TokenType.DOT)) {
                const property = this.consume(TokenType.IDENTIFIER, 'property').value;
                expr = {
                    kind: 'MemberExpr',
                    object: expr,
                    property,
                    span: { start: expr.span.start, end: this.previous().span.end },
                };
            } else if (this.match(TokenType.LBRACKET)) {
                const index = this.parseExpression();
                this.consume(TokenType.RBRACKET, ']');
                expr = {
                    kind: 'IndexExpr',
                    object: expr,
                    index,
                    span: { start: expr.span.start, end: this.previous().span.end },
                };
            } else if (this.check(TokenType.LBRACE) && expr.kind === 'Identifier') {
                // Ambiguity check: Is this a struct literal or a block?
                // Struct literal: Name { key: value } or Name { }
                // Block: Name { statement... }

                // Lookahead
                const next1 = this.tokens[this.current + 1];
                const next2 = this.tokens[this.current + 2];

                const isStructLiteral =
                    next1?.type === TokenType.RBRACE ||
                    (next1?.type === TokenType.IDENTIFIER && next2?.type === TokenType.COLON);

                if (isStructLiteral) {
                    this.advance(); // Consume {
                    expr = this.finishStructLiteral(expr.name, expr.span.start);
                } else {
                    break;
                }
            } else {
                break;
            }
        }

        return expr;
    }

    private finishStructLiteral(structName: string, start: SourceLocation): Expression {
        const fields: { name: string; value: Expression }[] = [];

        if (!this.check(TokenType.RBRACE)) {
            do {
                const name = this.consume(TokenType.IDENTIFIER, 'field name').value;
                this.consume(TokenType.COLON, ':');
                const value = this.parseExpression();
                fields.push({ name, value });
            } while (this.match(TokenType.COMMA));
        }

        this.consume(TokenType.RBRACE, '}');

        return {
            kind: 'StructLiteral',
            structName,
            fields,
            span: { start, end: this.previous().span.end },
        };
    }

    private finishCall(callee: Expression): Expression {
        const args: Expression[] = [];

        if (!this.check(TokenType.RPAREN)) {
            do {
                args.push(this.parseExpression());
            } while (this.match(TokenType.COMMA));
        }

        this.consume(TokenType.RPAREN, ')');

        return {
            kind: 'CallExpr',
            callee,
            arguments: args,
            span: { start: callee.span.start, end: this.previous().span.end },
        };
    }

    private parsePrimary(): Expression {
        const token = this.peek();
        const start = token.span.start;

        // Boolean literals
        if (this.match(TokenType.TRUE)) {
            return { kind: 'Literal', literalType: 'boolean', value: true, span: { start, end: this.previous().span.end } };
        }
        if (this.match(TokenType.FALSE)) {
            return { kind: 'Literal', literalType: 'boolean', value: false, span: { start, end: this.previous().span.end } };
        }

        // Integer literal
        if (this.match(TokenType.INTEGER)) {
            const value = BigInt(this.previous().value);
            return { kind: 'Literal', literalType: 'integer', value, span: { start, end: this.previous().span.end } };
        }

        // String literal
        if (this.match(TokenType.STRING)) {
            return { kind: 'Literal', literalType: 'string', value: this.previous().value, span: { start, end: this.previous().span.end } };
        }

        // Bytes literal
        if (this.match(TokenType.BYTES)) {
            return { kind: 'Literal', literalType: 'bytes', value: this.previous().value, span: { start, end: this.previous().span.end } };
        }

        // Context expressions
        if (this.match(TokenType.CALLER)) {
            return { kind: 'ContextExpr', context: 'caller', span: { start, end: this.previous().span.end } };
        }
        if (this.match(TokenType.BLOCK)) {
            let property: string | undefined;
            if (this.match(TokenType.DOT)) {
                property = this.consume(TokenType.IDENTIFIER, 'property').value;
            }
            return { kind: 'ContextExpr', context: 'block', property, span: { start, end: this.previous().span.end } };
        }
        if (this.match(TokenType.THIS)) {
            return { kind: 'ContextExpr', context: 'this', span: { start, end: this.previous().span.end } };
        }

        // State access
        if (this.match(TokenType.GET)) {
            return this.parseStateAccess('get', start);
        }
        if (this.match(TokenType.EXISTS)) {
            return this.parseStateAccess('exists', start);
        }

        // Grouped expression
        if (this.match(TokenType.LPAREN)) {
            const expr = this.parseExpression();
            this.consume(TokenType.RPAREN, ')');
            return expr;
        }

        // Identifier
        if (this.match(TokenType.IDENTIFIER)) {
            return { kind: 'Identifier', name: this.previous().value, span: { start, end: this.previous().span.end } };
        }

        throw new ParserError('Expected expression', token);
    }

    private parseStateAccess(operation: 'get' | 'exists', start: SourceLocation): Expression {
        this.consume(TokenType.LT, '<');
        const stateType = this.consume(TokenType.IDENTIFIER, 'state type').value;
        this.consume(TokenType.GT, '>');
        this.consume(TokenType.LPAREN, '(');
        const key = this.parseExpression();
        this.consume(TokenType.RPAREN, ')');

        return {
            kind: 'StateAccess',
            operation,
            stateType,
            key,
            span: { start, end: this.previous().span.end },
        };
    }

    // ============================================================================
    // Helper Methods
    // ============================================================================

    private peek(): Token {
        return this.tokens[this.current]!;
    }

    private previous(): Token {
        return this.tokens[this.current - 1]!;
    }

    private isAtEnd(): boolean {
        return this.peek().type === TokenType.EOF;
    }

    private advance(): Token {
        if (!this.isAtEnd()) this.current++;
        return this.previous();
    }

    private check(...types: TokenType[]): boolean {
        // Special case: when checking for EOF, don't short-circuit
        if (types.includes(TokenType.EOF)) {
            return types.includes(this.peek().type);
        }
        if (this.isAtEnd()) return false;
        return types.includes(this.peek().type);
    }

    private match(...types: TokenType[]): boolean {
        for (const type of types) {
            if (this.check(type)) {
                this.advance();
                return true;
            }
        }
        return false;
    }

    private consume(type: TokenType, expected: string): Token {
        if (this.check(type)) return this.advance();
        throw new ParserError(`Unexpected token: ${this.peek().value}`, this.peek(), expected);
    }
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Parses source code into a Module AST
 */
export function parse(source: string): Module {
    const lexer = new Lexer(source);
    const tokens = lexer.tokenize();
    const parser = new Parser(tokens);
    return parser.parseModule();
}

/**
 * Parses a single expression (for REPL/testing)
 */
export function parseExpression(source: string): Expression {
    const lexer = new Lexer(source);
    const tokens = lexer.tokenize();
    const parser = new Parser(tokens);
    return (parser as any).parseExpression();
}
