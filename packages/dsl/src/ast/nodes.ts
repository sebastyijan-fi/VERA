/**
 * VERA DSL Abstract Syntax Tree (AST) Node Types
 *
 * Defines all AST node types for the VERA DSL.
 * The AST represents the parsed structure of VERA source code.
 */

import type { SourceSpan } from '../lexer/tokens.js';

// ============================================================================
// Base Node Interface
// ============================================================================

/**
 * Base interface for all AST nodes
 */
export interface AstNode {
    readonly kind: string;
    readonly span: SourceSpan;
}

// ============================================================================
// Type Nodes
// ============================================================================

export type TypeNode =
    | PrimitiveTypeNode
    | AddressTypeNode
    | FixedTypeNode
    | ListTypeNode
    | MapTypeNode
    | OptionalTypeNode
    | NamedTypeNode;

export interface PrimitiveTypeNode extends AstNode {
    readonly kind: 'PrimitiveType';
    readonly name: 'UInt' | 'Int' | 'Bool' | 'String' | 'Bytes';
    readonly bits?: number | undefined; // For UInt and Int (e.g., UInt<64>)
}

export interface AddressTypeNode extends AstNode {
    readonly kind: 'AddressType';
}

export interface FixedTypeNode extends AstNode {
    readonly kind: 'FixedType';
    readonly precision: number;
    readonly scale: number;
}

export interface ListTypeNode extends AstNode {
    readonly kind: 'ListType';
    readonly elementType: TypeNode;
    readonly maxLength?: number | undefined;
}

export interface MapTypeNode extends AstNode {
    readonly kind: 'MapType';
    readonly keyType: TypeNode;
    readonly valueType: TypeNode;
}

export interface OptionalTypeNode extends AstNode {
    readonly kind: 'OptionalType';
    readonly innerType: TypeNode;
}

export interface NamedTypeNode extends AstNode {
    readonly kind: 'NamedType';
    readonly module?: string | undefined;
    readonly name: string;
}

// ============================================================================
// Expression Nodes
// ============================================================================

export type Expression =
    | IdentifierExpr
    | LiteralExpr
    | BinaryExpr
    | UnaryExpr
    | CallExpr
    | MemberExpr
    | IndexExpr
    | ContextExpr
    | StateAccessExpr
    | StructLiteralExpr
    | TernaryExpr;

export interface IdentifierExpr extends AstNode {
    readonly kind: 'Identifier';
    readonly name: string;
}

export interface LiteralExpr extends AstNode {
    readonly kind: 'Literal';
    readonly literalType: 'integer' | 'string' | 'bytes' | 'boolean';
    readonly value: string | bigint | boolean;
}

export interface BinaryExpr extends AstNode {
    readonly kind: 'BinaryExpr';
    readonly operator:
    | '+' | '-' | '*' | '/' | '%'
    | '==' | '!=' | '<' | '>' | '<=' | '>='
    | '&&' | '||' | 'and' | 'or';
    readonly left: Expression;
    readonly right: Expression;
}

export interface UnaryExpr extends AstNode {
    readonly kind: 'UnaryExpr';
    readonly operator: '-' | '!' | 'not';
    readonly operand: Expression;
}

export interface CallExpr extends AstNode {
    readonly kind: 'CallExpr';
    readonly callee: Expression;
    readonly arguments: readonly Expression[];
}

export interface MemberExpr extends AstNode {
    readonly kind: 'MemberExpr';
    readonly object: Expression;
    readonly property: string;
}

export interface IndexExpr extends AstNode {
    readonly kind: 'IndexExpr';
    readonly object: Expression;
    readonly index: Expression;
}

export interface ContextExpr extends AstNode {
    readonly kind: 'ContextExpr';
    readonly context: 'caller' | 'block' | 'this';
    readonly property?: string | undefined;
}

export interface StateAccessExpr extends AstNode {
    readonly kind: 'StateAccess';
    readonly operation: 'get' | 'exists';
    readonly stateType: string;
    readonly key: Expression;
}

export interface TernaryExpr extends AstNode {
    readonly kind: 'TernaryExpr';
    readonly condition: Expression;
    readonly consequent: Expression;
    readonly alternate: Expression;
}

export interface StructLiteralExpr extends AstNode {
    readonly kind: 'StructLiteral';
    readonly structName: string;
    readonly fields: readonly { name: string; value: Expression }[];
}

// ============================================================================
// Statement Nodes
// ============================================================================

export type Statement =
    | LetStatement
    | SetStatement
    | DeleteStatement
    | IfStatement
    | ForStatement
    | WhileStatement
    | BreakStatement
    | ContinueStatement
    | ReturnStatement
    | RequireStatement
    | EnsureStatement
    | EmitStatement
    | ExpressionStatement;

export interface LetStatement extends AstNode {
    readonly kind: 'LetStatement';
    readonly name: string;
    readonly typeAnnotation?: TypeNode | undefined;
    readonly initializer: Expression;
}

export interface SetStatement extends AstNode {
    readonly kind: 'SetStatement';
    readonly target: Expression;
    readonly value: Expression;
}

export interface DeleteStatement extends AstNode {
    readonly kind: 'DeleteStatement';
    readonly target: Expression;
}

export interface IfStatement extends AstNode {
    readonly kind: 'IfStatement';
    readonly condition: Expression;
    readonly consequent: readonly Statement[];
    readonly alternate?: readonly Statement[] | IfStatement | undefined;
}

export interface ForStatement extends AstNode {
    readonly kind: 'ForStatement';
    readonly variable: string;
    readonly iterable: Expression;
    readonly body: readonly Statement[];
    readonly maxIterations?: number | undefined;
}

export interface WhileStatement extends AstNode {
    readonly kind: 'WhileStatement';
    readonly condition: Expression;
    readonly body: readonly Statement[];
    readonly maxIterations: number; // Required for bounded loops
}

export interface BreakStatement extends AstNode {
    readonly kind: 'BreakStatement';
}

export interface ContinueStatement extends AstNode {
    readonly kind: 'ContinueStatement';
}

export interface ReturnStatement extends AstNode {
    readonly kind: 'ReturnStatement';
    readonly value?: Expression | undefined;
}

export interface RequireStatement extends AstNode {
    readonly kind: 'RequireStatement';
    readonly condition: Expression;
    readonly message?: string | undefined;
}

export interface EnsureStatement extends AstNode {
    readonly kind: 'EnsureStatement';
    readonly condition: Expression;
    readonly message?: string | undefined;
}

export interface EmitStatement extends AstNode {
    readonly kind: 'EmitStatement';
    readonly eventName: string;
    readonly arguments: readonly Expression[];
}

export interface ExpressionStatement extends AstNode {
    readonly kind: 'ExpressionStatement';
    readonly expression: Expression;
}

// ============================================================================
// Declaration Nodes
// ============================================================================

export type Declaration =
    | TypeDeclaration
    | EntityDeclaration
    | TransactionDeclaration
    | EventDeclaration
    | InvariantDeclaration;

export interface FieldDefinition extends AstNode {
    readonly kind: 'FieldDefinition';
    readonly name: string;
    readonly type: TypeNode;
    readonly defaultValue?: Expression | undefined;
}

export interface TypeDeclaration extends AstNode {
    readonly kind: 'TypeDeclaration';
    readonly name: string;
    readonly visibility: 'public' | 'private';
    readonly definition:
    | { type: 'alias'; target: TypeNode }
    | { type: 'struct'; fields: readonly FieldDefinition[] }
    | { type: 'enum'; variants: readonly string[] };
}

export interface EntityDeclaration extends AstNode {
    readonly kind: 'EntityDeclaration';
    readonly name: string;
    readonly visibility: 'public' | 'private';
    readonly keyType: TypeNode;
    readonly fields: readonly FieldDefinition[];
}

export interface ParamDefinition extends AstNode {
    readonly kind: 'ParamDefinition';
    readonly name: string;
    readonly type: TypeNode;
    readonly defaultValue?: Expression | undefined;
}

export interface TransactionDeclaration extends AstNode {
    readonly kind: 'TransactionDeclaration';
    readonly name: string;
    readonly visibility: 'public' | 'private';
    readonly params: readonly ParamDefinition[];
    readonly body: readonly Statement[];
}

export interface EventDeclaration extends AstNode {
    readonly kind: 'EventDeclaration';
    readonly name: string;
    readonly fields: readonly FieldDefinition[];
}

export interface InvariantDeclaration extends AstNode {
    readonly kind: 'InvariantDeclaration';
    readonly name: string;
    readonly condition: Expression;
}

// ============================================================================
// Module Nodes
// ============================================================================

export interface ImportStatement extends AstNode {
    readonly kind: 'ImportStatement';
    readonly items: readonly { name: string; alias?: string | undefined }[];
    readonly from: string;
}

export interface Module extends AstNode {
    readonly kind: 'Module';
    readonly name: string;
    readonly imports: readonly ImportStatement[];
    readonly declarations: readonly Declaration[];
}

// ============================================================================
// AST Factory Functions
// ============================================================================

export function createIdentifier(name: string, span: SourceSpan): IdentifierExpr {
    return { kind: 'Identifier', name, span };
}

export function createLiteral(
    literalType: LiteralExpr['literalType'],
    value: LiteralExpr['value'],
    span: SourceSpan
): LiteralExpr {
    return { kind: 'Literal', literalType, value, span };
}

export function createBinaryExpr(
    operator: BinaryExpr['operator'],
    left: Expression,
    right: Expression,
    span: SourceSpan
): BinaryExpr {
    return { kind: 'BinaryExpr', operator, left, right, span };
}

export function createUnaryExpr(
    operator: UnaryExpr['operator'],
    operand: Expression,
    span: SourceSpan
): UnaryExpr {
    return { kind: 'UnaryExpr', operator, operand, span };
}

export function createCallExpr(
    callee: Expression,
    args: readonly Expression[],
    span: SourceSpan
): CallExpr {
    return { kind: 'CallExpr', callee, arguments: args, span };
}

export function createMemberExpr(
    object: Expression,
    property: string,
    span: SourceSpan
): MemberExpr {
    return { kind: 'MemberExpr', object, property, span };
}
