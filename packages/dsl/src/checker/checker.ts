/**
 * VERA DSL Type Checker
 *
 * Performs semantic analysis and type checking on the AST.
 * Ensures type correctness and catches common errors.
 */

import type {
    Module,
    Declaration,
    Statement,
    Expression,
    TypeNode,
    EntityDeclaration,
    TransactionDeclaration,
    TypeDeclaration,
} from '../ast/nodes.js';

// ============================================================================
// Type System
// ============================================================================

/**
 * Represents a resolved type in the type system
 */
export type Type =
    | { kind: 'void' }
    | { kind: 'bool' }
    | { kind: 'int'; bits: number; signed: boolean }
    | { kind: 'string' }
    | { kind: 'bytes' }
    | { kind: 'address' }
    | { kind: 'fixed'; precision: number; scale: number }
    | { kind: 'list'; element: Type; maxLength?: number }
    | { kind: 'map'; key: Type; value: Type }
    | { kind: 'optional'; inner: Type }
    | { kind: 'entity'; name: string; fields: Map<string, Type> }
    | { kind: 'struct'; name: string; fields: Map<string, Type> }
    | { kind: 'enum'; name: string; variants: string[] }
    | { kind: 'unknown' }
    | { kind: 'error'; message: string };

// ============================================================================
// Symbol Table
// ============================================================================

export interface Symbol {
    name: string;
    type: Type;
    kind: 'variable' | 'parameter' | 'entity' | 'type' | 'event' | 'transaction';
    mutable: boolean;
}

export class Scope {
    private symbols = new Map<string, Symbol>();

    constructor(public readonly parent?: Scope) { }

    define(name: string, symbol: Symbol): void {
        this.symbols.set(name, symbol);
    }

    lookup(name: string): Symbol | undefined {
        const local = this.symbols.get(name);
        if (local) return local;
        return this.parent?.lookup(name);
    }

    lookupLocal(name: string): Symbol | undefined {
        return this.symbols.get(name);
    }
}

// ============================================================================
// Type Checker Error
// ============================================================================

export class TypeCheckError extends Error {
    constructor(
        message: string,
        public readonly node: { span: { start: { line: number; column: number } } }
    ) {
        super(`${message} at line ${node.span.start.line}, column ${node.span.start.column}`);
        this.name = 'TypeCheckError';
    }
}

// ============================================================================
// Type Checker
// ============================================================================

export class TypeChecker {
    private scope: Scope;
    private entities = new Map<string, EntityDeclaration>();
    private types = new Map<string, TypeDeclaration>();
    private errors: TypeCheckError[] = [];

    constructor() {
        this.scope = new Scope();
    }

    /**
     * Type checks a module and returns any errors
     */
    check(module: Module): TypeCheckError[] {
        this.errors = [];

        // First pass: collect all declarations
        for (const decl of module.declarations) {
            this.collectDeclaration(decl);
        }

        // Second pass: type check all declarations
        for (const decl of module.declarations) {
            this.checkDeclaration(decl);
        }

        return this.errors;
    }

    /**
     * Gets all collected errors
     */
    getErrors(): TypeCheckError[] {
        return this.errors;
    }

    // ============================================================================
    // Declaration Collection
    // ============================================================================

    private collectDeclaration(decl: Declaration): void {
        switch (decl.kind) {
            case 'EntityDeclaration':
                this.entities.set(decl.name, decl);
                this.scope.define(decl.name, {
                    name: decl.name,
                    type: this.entityToType(decl),
                    kind: 'entity',
                    mutable: false,
                });
                break;
            case 'TypeDeclaration':
                this.types.set(decl.name, decl);
                this.scope.define(decl.name, {
                    name: decl.name,
                    type: this.typeDeclarationToType(decl),
                    kind: 'type',
                    mutable: false,
                });
                break;
            case 'TransactionDeclaration':
                this.scope.define(decl.name, {
                    name: decl.name,
                    type: { kind: 'void' },
                    kind: 'transaction',
                    mutable: false,
                });
                break;
            case 'EventDeclaration':
                this.scope.define(decl.name, {
                    name: decl.name,
                    type: { kind: 'void' },
                    kind: 'event',
                    mutable: false,
                });
                break;
        }
    }

    private entityToType(decl: EntityDeclaration): Type {
        const fields = new Map<string, Type>();
        for (const field of decl.fields) {
            fields.set(field.name, this.resolveType(field.type));
        }
        return { kind: 'entity', name: decl.name, fields };
    }

    private typeDeclarationToType(decl: TypeDeclaration): Type {
        switch (decl.definition.type) {
            case 'alias':
                return this.resolveType(decl.definition.target);
            case 'struct': {
                const fields = new Map<string, Type>();
                for (const field of decl.definition.fields) {
                    fields.set(field.name, this.resolveType(field.type));
                }
                return { kind: 'struct', name: decl.name, fields };
            }
            case 'enum':
                return { kind: 'enum', name: decl.name, variants: [...decl.definition.variants] };
        }
    }

    // ============================================================================
    // Type Resolution
    // ============================================================================

    private resolveType(typeNode: TypeNode): Type {
        switch (typeNode.kind) {
            case 'PrimitiveType':
                switch (typeNode.name) {
                    case 'Bool':
                        return { kind: 'bool' };
                    case 'String':
                        return { kind: 'string' };
                    case 'Bytes':
                        return { kind: 'bytes' };
                    case 'UInt':
                        return { kind: 'int', bits: typeNode.bits ?? 256, signed: false };
                    case 'Int':
                        return { kind: 'int', bits: typeNode.bits ?? 256, signed: true };
                }
                break;
            case 'AddressType':
                return { kind: 'address' };
            case 'FixedType':
                return { kind: 'fixed', precision: typeNode.precision, scale: typeNode.scale };
            case 'ListType': {
                const listType: Type = {
                    kind: 'list',
                    element: this.resolveType(typeNode.elementType),
                };
                if (typeNode.maxLength !== undefined) {
                    listType.maxLength = typeNode.maxLength;
                }
                return listType;
            }
            case 'MapType':
                return {
                    kind: 'map',
                    key: this.resolveType(typeNode.keyType),
                    value: this.resolveType(typeNode.valueType),
                };
            case 'OptionalType':
                return { kind: 'optional', inner: this.resolveType(typeNode.innerType) };
            case 'NamedType': {
                const symbol = this.scope.lookup(typeNode.name);
                if (!symbol) {
                    return { kind: 'error', message: `Unknown type: ${typeNode.name}` };
                }
                return symbol.type;
            }
        }
        return { kind: 'unknown' };
    }

    // ============================================================================
    // Declaration Checking
    // ============================================================================

    private checkDeclaration(decl: Declaration): void {
        switch (decl.kind) {
            case 'EntityDeclaration':
                this.checkEntityDeclaration(decl);
                break;
            case 'TransactionDeclaration':
                this.checkTransactionDeclaration(decl);
                break;
            case 'TypeDeclaration':
                this.checkTypeDeclaration(decl);
                break;
        }
    }

    private checkEntityDeclaration(decl: EntityDeclaration): void {
        // Check that all field types are valid
        for (const field of decl.fields) {
            const type = this.resolveType(field.type);
            if (type.kind === 'error') {
                this.errors.push(new TypeCheckError(type.message, field));
            }
            if (field.defaultValue) {
                const valueType = this.checkExpression(field.defaultValue);
                if (!this.isAssignable(type, valueType)) {
                    this.errors.push(
                        new TypeCheckError(
                            `Default value type mismatch for field ${field.name}`,
                            field
                        )
                    );
                }
            }
        }
    }

    private checkTransactionDeclaration(decl: TransactionDeclaration): void {
        // Create a new scope for the transaction
        const prevScope = this.scope;
        this.scope = new Scope(prevScope);

        // Add parameters to scope
        for (const param of decl.params) {
            const type = this.resolveType(param.type);
            this.scope.define(param.name, {
                name: param.name,
                type,
                kind: 'parameter',
                mutable: false,
            });
        }

        // Check body statements
        for (const stmt of decl.body) {
            this.checkStatement(stmt);
        }

        // Restore scope
        this.scope = prevScope;
    }

    private checkTypeDeclaration(decl: TypeDeclaration): void {
        if (decl.definition.type === 'struct') {
            for (const field of decl.definition.fields) {
                const type = this.resolveType(field.type);
                if (type.kind === 'error') {
                    this.errors.push(new TypeCheckError(type.message, field));
                }
            }
        }
    }

    // ============================================================================
    // Statement Checking
    // ============================================================================

    private checkStatement(stmt: Statement): void {
        switch (stmt.kind) {
            case 'LetStatement': {
                const valueType = this.checkExpression(stmt.initializer);
                if (stmt.typeAnnotation) {
                    const declaredType = this.resolveType(stmt.typeAnnotation);
                    if (!this.isAssignable(declaredType, valueType)) {
                        this.errors.push(
                            new TypeCheckError(`Type mismatch in let statement for ${stmt.name}`, stmt)
                        );
                    }
                    this.scope.define(stmt.name, {
                        name: stmt.name,
                        type: declaredType,
                        kind: 'variable',
                        mutable: false,
                    });
                } else {
                    this.scope.define(stmt.name, {
                        name: stmt.name,
                        type: valueType,
                        kind: 'variable',
                        mutable: false,
                    });
                }
                break;
            }
            case 'SetStatement': {
                const targetType = this.checkExpression(stmt.target);
                const valueType = this.checkExpression(stmt.value);
                if (!this.isAssignable(targetType, valueType)) {
                    this.errors.push(new TypeCheckError('Type mismatch in set statement', stmt));
                }
                break;
            }
            case 'RequireStatement':
            case 'EnsureStatement': {
                const condType = this.checkExpression(stmt.condition);
                if (condType.kind !== 'bool') {
                    this.errors.push(
                        new TypeCheckError(`${stmt.kind} condition must be boolean`, stmt)
                    );
                }
                break;
            }
            case 'IfStatement': {
                const condType = this.checkExpression(stmt.condition);
                if (condType.kind !== 'bool') {
                    this.errors.push(new TypeCheckError('If condition must be boolean', stmt));
                }
                for (const s of stmt.consequent) {
                    this.checkStatement(s);
                }
                if (stmt.alternate) {
                    if ('kind' in stmt.alternate && stmt.alternate.kind === 'IfStatement') {
                        // It's an else-if chain
                        this.checkStatement(stmt.alternate);
                    } else {
                        // It's an else block (array of statements)
                        for (const s of stmt.alternate as readonly Statement[]) {
                            this.checkStatement(s);
                        }
                    }
                }
                break;
            }
            case 'ForStatement': {
                const iterType = this.checkExpression(stmt.iterable);
                if (iterType.kind !== 'list') {
                    this.errors.push(new TypeCheckError('For loop requires a list', stmt));
                }
                const prevScope = this.scope;
                this.scope = new Scope(prevScope);
                this.scope.define(stmt.variable, {
                    name: stmt.variable,
                    type: iterType.kind === 'list' ? iterType.element : { kind: 'unknown' },
                    kind: 'variable',
                    mutable: false,
                });
                for (const s of stmt.body) {
                    this.checkStatement(s);
                }
                this.scope = prevScope;
                break;
            }
            case 'WhileStatement': {
                const condType = this.checkExpression(stmt.condition);
                if (condType.kind !== 'bool') {
                    this.errors.push(new TypeCheckError('While condition must be boolean', stmt));
                }
                for (const s of stmt.body) {
                    this.checkStatement(s);
                }
                break;
            }
            case 'ExpressionStatement':
                this.checkExpression(stmt.expression);
                break;
            case 'EmitStatement':
                for (const arg of stmt.arguments) {
                    this.checkExpression(arg);
                }
                break;
            case 'DeleteStatement':
                this.checkExpression(stmt.target);
                break;
            case 'ReturnStatement':
                if (stmt.value) {
                    this.checkExpression(stmt.value);
                }
                break;
        }
    }

    // ============================================================================
    // Expression Checking
    // ============================================================================

    private checkExpression(expr: Expression): Type {
        switch (expr.kind) {
            case 'Literal':
                switch (expr.literalType) {
                    case 'boolean':
                        return { kind: 'bool' };
                    case 'integer':
                        return { kind: 'int', bits: 256, signed: false };
                    case 'string':
                        return { kind: 'string' };
                    case 'bytes':
                        return { kind: 'bytes' };
                }
                break;
            case 'Identifier': {
                const symbol = this.scope.lookup(expr.name);
                if (!symbol) {
                    this.errors.push(new TypeCheckError(`Unknown identifier: ${expr.name}`, expr));
                    return { kind: 'unknown' };
                }
                return symbol.type;
            }
            case 'BinaryExpr': {
                const leftType = this.checkExpression(expr.left);
                const rightType = this.checkExpression(expr.right);
                return this.checkBinaryOp(expr.operator, leftType, rightType, expr);
            }
            case 'UnaryExpr': {
                const operandType = this.checkExpression(expr.operand);
                return this.checkUnaryOp(expr.operator, operandType, expr);
            }
            case 'CallExpr': {
                this.checkExpression(expr.callee);
                for (const arg of expr.arguments) {
                    this.checkExpression(arg);
                }
                return { kind: 'unknown' }; // Would need function type info
            }
            case 'MemberExpr': {
                const objType = this.checkExpression(expr.object);
                if (objType.kind === 'entity' || objType.kind === 'struct') {
                    const fieldType = objType.fields.get(expr.property);
                    if (!fieldType) {
                        this.errors.push(
                            new TypeCheckError(`Unknown field: ${expr.property}`, expr)
                        );
                        return { kind: 'unknown' };
                    }
                    return fieldType;
                }
                return { kind: 'unknown' };
            }
            case 'IndexExpr': {
                const objType = this.checkExpression(expr.object);
                this.checkExpression(expr.index);
                if (objType.kind === 'list') {
                    return objType.element;
                }
                if (objType.kind === 'map') {
                    return objType.value;
                }
                return { kind: 'unknown' };
            }
            case 'ContextExpr':
                switch (expr.context) {
                    case 'caller':
                        return { kind: 'address' };
                    case 'block':
                        return { kind: 'unknown' }; // Block properties vary
                    case 'this':
                        return { kind: 'unknown' };
                }
                break;
            case 'StateAccess': {
                const entity = this.entities.get(expr.stateType);
                if (!entity) {
                    this.errors.push(
                        new TypeCheckError(`Unknown entity: ${expr.stateType}`, expr)
                    );
                    return { kind: 'unknown' };
                }
                this.checkExpression(expr.key);
                if (expr.operation === 'exists') {
                    return { kind: 'bool' };
                }
                return this.entityToType(entity);
            }
            case 'TernaryExpr': {
                const condType = this.checkExpression(expr.condition);
                if (condType.kind !== 'bool') {
                    this.errors.push(new TypeCheckError('Ternary condition must be boolean', expr));
                }
                const consType = this.checkExpression(expr.consequent);
                const altType = this.checkExpression(expr.alternate);
                if (!this.isAssignable(consType, altType)) {
                    this.errors.push(new TypeCheckError('Ternary branches must have same type', expr));
                }
                return consType;
            }
        }
        return { kind: 'unknown' };
    }

    private checkBinaryOp(
        op: string,
        left: Type,
        right: Type,
        expr: Expression
    ): Type {
        // Arithmetic operators
        if (['+', '-', '*', '/', '%'].includes(op)) {
            if (left.kind !== 'int' || right.kind !== 'int') {
                this.errors.push(
                    new TypeCheckError(`Operator ${op} requires integer operands`, expr)
                );
            }
            return left;
        }

        // Comparison operators
        if (['==', '!=', '<', '>', '<=', '>='].includes(op)) {
            return { kind: 'bool' };
        }

        // Logical operators
        if (['&&', '||', 'and', 'or'].includes(op)) {
            if (left.kind !== 'bool' || right.kind !== 'bool') {
                this.errors.push(
                    new TypeCheckError(`Operator ${op} requires boolean operands`, expr)
                );
            }
            return { kind: 'bool' };
        }

        return { kind: 'unknown' };
    }

    private checkUnaryOp(op: string, operand: Type, expr: Expression): Type {
        if (op === '-') {
            if (operand.kind !== 'int') {
                this.errors.push(new TypeCheckError('Unary minus requires integer', expr));
            }
            return operand;
        }
        if (op === '!' || op === 'not') {
            if (operand.kind !== 'bool') {
                this.errors.push(new TypeCheckError('Not operator requires boolean', expr));
            }
            return { kind: 'bool' };
        }
        return { kind: 'unknown' };
    }

    // ============================================================================
    // Type Compatibility
    // ============================================================================

    private isAssignable(target: Type, source: Type): boolean {
        if (target.kind === 'unknown' || source.kind === 'unknown') {
            return true; // Unknown is compatible with anything
        }
        if (target.kind === 'error' || source.kind === 'error') {
            return false;
        }
        if (target.kind !== source.kind) {
            return false;
        }

        // Same kind - check details
        switch (target.kind) {
            case 'int':
                return source.kind === 'int';
            case 'list':
                return (
                    source.kind === 'list' &&
                    this.isAssignable(target.element, source.element)
                );
            case 'map':
                return (
                    source.kind === 'map' &&
                    this.isAssignable(target.key, source.key) &&
                    this.isAssignable(target.value, source.value)
                );
            case 'optional':
                return (
                    source.kind === 'optional' &&
                    this.isAssignable(target.inner, source.inner)
                );
            case 'entity':
            case 'struct':
                return source.kind === target.kind && target.name === source.name;
            case 'enum':
                return source.kind === 'enum' && target.name === source.name;
            default:
                return true;
        }
    }
}

// ============================================================================
// Convenience Function
// ============================================================================

/**
 * Type checks a module and returns any errors
 */
export function typeCheck(module: Module): TypeCheckError[] {
    const checker = new TypeChecker();
    return checker.check(module);
}
