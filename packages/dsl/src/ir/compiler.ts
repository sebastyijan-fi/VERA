/**
 * VERA DSL IR Compiler
 *
 * Compiles type-checked AST to IR instructions.
 */

import type {
    Module,
    Declaration,
    Statement,
    Expression,
    EntityDeclaration,
    TransactionDeclaration,
    EventDeclaration,
} from '../ast/nodes.js';
import {
    type IRProgram,
    type IRFunction,
    type IRInstruction,
    type IREntity,
    type IREvent,
    type IRValue,
    IROpcode,
    ir,
    createIRProgram,
} from './types.js';

// ============================================================================
// IR Compiler
// ============================================================================

/**
 * Compiles a VERA AST Module to IR
 */
export class IRCompiler {
    private program!: IRProgram;
    private currentFunction: IRFunction | null = null;
    private labelCounter = 0;
    private locals = new Map<string, number>();
    private loopEndLabels: string[] = [];
    private loopStartLabels: string[] = [];

    /**
     * Compiles a module to IR
     */
    compile(module: Module): IRProgram {
        this.program = createIRProgram(module.name);
        this.labelCounter = 0;

        for (const decl of module.declarations) {
            this.compileDeclaration(decl);
        }

        return this.program;
    }

    // ============================================================================
    // Declaration Compilation
    // ============================================================================

    private compileDeclaration(decl: Declaration): void {
        switch (decl.kind) {
            case 'EntityDeclaration':
                this.compileEntity(decl);
                break;
            case 'TransactionDeclaration':
                this.compileTransaction(decl);
                break;
            case 'EventDeclaration':
                this.compileEvent(decl);
                break;
        }
    }

    private compileEntity(decl: EntityDeclaration): void {
        const entity: IREntity = {
            name: decl.name,
            keyType: this.typeToString(decl.keyType),
            fields: decl.fields.map(f => ({
                name: f.name,
                type: this.typeToString(f.type),
            })),
        };
        this.program.entities.push(entity);
    }

    private compileTransaction(decl: TransactionDeclaration): void {
        this.locals.clear();

        // Add parameters as locals
        const params: string[] = [];
        for (const param of decl.params) {
            params.push(param.name);
            this.locals.set(param.name, this.locals.size);
        }

        const func: IRFunction = {
            name: decl.name,
            params,
            locals: [],
            instructions: [],
            isPublic: decl.visibility === 'public',
        };

        this.currentFunction = func;

        // Compile body
        for (const stmt of decl.body) {
            this.compileStatement(stmt);
        }

        // Ensure function ends with HALT
        this.emit(ir(IROpcode.HALT));

        // Record locals
        func.locals = [...this.locals.keys()].filter(k => !params.includes(k));

        this.program.functions.push(func);
        this.currentFunction = null;
    }

    private compileEvent(decl: EventDeclaration): void {
        const event: IREvent = {
            name: decl.name,
            fields: decl.fields.map(f => ({
                name: f.name,
                type: this.typeToString(f.type),
            })),
        };
        this.program.events.push(event);
    }

    // ============================================================================
    // Statement Compilation
    // ============================================================================

    private compileStatement(stmt: Statement): void {
        switch (stmt.kind) {
            case 'LetStatement':
                this.compileExpression(stmt.initializer);
                this.declareLocal(stmt.name);
                this.emit(ir(IROpcode.STORE, stmt.name, stmt.span));
                break;

            case 'SetStatement':
                this.compileExpression(stmt.value);
                this.compileAssignmentTarget(stmt.target);
                break;

            case 'DeleteStatement':
                this.compileDeleteTarget(stmt.target);
                break;

            case 'IfStatement':
                this.compileIfStatement(stmt);
                break;

            case 'ForStatement':
                this.compileForStatement(stmt);
                break;

            case 'WhileStatement':
                this.compileWhileStatement(stmt);
                break;

            case 'RequireStatement':
                this.compileExpression(stmt.condition);
                this.emit(ir(IROpcode.REQUIRE, stmt.message ?? 'Requirement failed', stmt.span));
                break;

            case 'EnsureStatement':
                this.compileExpression(stmt.condition);
                this.emit(ir(IROpcode.ENSURE, stmt.message ?? 'Postcondition failed', stmt.span));
                break;

            case 'EmitStatement':
                for (const arg of stmt.arguments) {
                    this.compileExpression(arg);
                }
                this.emit(ir(IROpcode.EMIT, stmt.eventName, stmt.span));
                break;

            case 'ReturnStatement':
                if (stmt.value) {
                    this.compileExpression(stmt.value);
                }
                this.emit(ir(IROpcode.RET, undefined, stmt.span));
                break;

            case 'BreakStatement':
                if (this.loopEndLabels.length > 0) {
                    this.emit(ir(IROpcode.JMP, this.loopEndLabels[this.loopEndLabels.length - 1], stmt.span));
                }
                break;

            case 'ContinueStatement':
                if (this.loopStartLabels.length > 0) {
                    this.emit(ir(IROpcode.JMP, this.loopStartLabels[this.loopStartLabels.length - 1], stmt.span));
                }
                break;

            case 'ExpressionStatement':
                this.compileExpression(stmt.expression);
                this.emit(ir(IROpcode.POP)); // Discard result
                break;
        }
    }

    private compileIfStatement(stmt: Statement & { kind: 'IfStatement' }): void {
        const elseLabel = this.newLabel('else');
        const endLabel = this.newLabel('endif');

        // Compile condition
        this.compileExpression(stmt.condition);
        this.emit(ir(IROpcode.JMP_IF_NOT, elseLabel, stmt.span));

        // Compile consequent
        for (const s of stmt.consequent) {
            this.compileStatement(s);
        }
        this.emit(ir(IROpcode.JMP, endLabel));

        // Compile alternate
        this.emitLabel(elseLabel);
        if (stmt.alternate) {
            if ('kind' in stmt.alternate && stmt.alternate.kind === 'IfStatement') {
                this.compileIfStatement(stmt.alternate);
            } else {
                for (const s of stmt.alternate as readonly Statement[]) {
                    this.compileStatement(s);
                }
            }
        }

        this.emitLabel(endLabel);
    }

    private compileForStatement(stmt: Statement & { kind: 'ForStatement' }): void {
        const startLabel = this.newLabel('for_start');
        const endLabel = this.newLabel('for_end');

        // Push/track labels for break/continue
        this.loopStartLabels.push(startLabel);
        this.loopEndLabels.push(endLabel);

        // Compile iterable and get iterator
        this.compileExpression(stmt.iterable);
        this.emit(ir(IROpcode.LIST_LEN));

        // Initialize index variable
        this.emit(ir(IROpcode.PUSH, { kind: 'int', value: 0n }));
        const indexVar = `__for_idx_${this.labelCounter}`;
        this.declareLocal(indexVar);
        this.emit(ir(IROpcode.STORE, indexVar));

        const lenVar = `__for_len_${this.labelCounter}`;
        this.declareLocal(lenVar);
        this.emit(ir(IROpcode.STORE, lenVar));

        const listVar = `__for_list_${this.labelCounter}`;
        this.declareLocal(listVar);
        this.compileExpression(stmt.iterable);
        this.emit(ir(IROpcode.STORE, listVar));

        // Loop start
        this.emitLabel(startLabel);

        // Check condition: idx < len
        this.emit(ir(IROpcode.LOAD, indexVar));
        this.emit(ir(IROpcode.LOAD, lenVar));
        this.emit(ir(IROpcode.LT));
        this.emit(ir(IROpcode.JMP_IF_NOT, endLabel));

        // Get current element
        this.emit(ir(IROpcode.LOAD, listVar));
        this.emit(ir(IROpcode.LOAD, indexVar));
        this.emit(ir(IROpcode.LIST_GET));
        this.declareLocal(stmt.variable);
        this.emit(ir(IROpcode.STORE, stmt.variable));

        // Compile body
        for (const s of stmt.body) {
            this.compileStatement(s);
        }

        // Increment index
        this.emit(ir(IROpcode.LOAD, indexVar));
        this.emit(ir(IROpcode.PUSH, { kind: 'int', value: 1n }));
        this.emit(ir(IROpcode.ADD));
        this.emit(ir(IROpcode.STORE, indexVar));

        // Jump back to start
        this.emit(ir(IROpcode.JMP, startLabel));

        // Loop end
        this.emitLabel(endLabel);

        this.loopStartLabels.pop();
        this.loopEndLabels.pop();
    }

    private compileWhileStatement(stmt: Statement & { kind: 'WhileStatement' }): void {
        const startLabel = this.newLabel('while_start');
        const endLabel = this.newLabel('while_end');

        this.loopStartLabels.push(startLabel);
        this.loopEndLabels.push(endLabel);

        // Initialize iteration counter for bounded loops
        this.emit(ir(IROpcode.PUSH, { kind: 'int', value: 0n }));
        const iterVar = `__while_iter_${this.labelCounter}`;
        this.declareLocal(iterVar);
        this.emit(ir(IROpcode.STORE, iterVar));

        this.emitLabel(startLabel);

        // Check iteration limit
        this.emit(ir(IROpcode.LOAD, iterVar));
        this.emit(ir(IROpcode.PUSH, { kind: 'int', value: BigInt(stmt.maxIterations) }));
        this.emit(ir(IROpcode.GTE));
        this.emit(ir(IROpcode.JMP_IF, endLabel));

        // Check condition
        this.compileExpression(stmt.condition);
        this.emit(ir(IROpcode.JMP_IF_NOT, endLabel, stmt.span));

        // Compile body
        for (const s of stmt.body) {
            this.compileStatement(s);
        }

        // Increment iteration counter
        this.emit(ir(IROpcode.LOAD, iterVar));
        this.emit(ir(IROpcode.PUSH, { kind: 'int', value: 1n }));
        this.emit(ir(IROpcode.ADD));
        this.emit(ir(IROpcode.STORE, iterVar));

        this.emit(ir(IROpcode.JMP, startLabel));

        this.emitLabel(endLabel);

        this.loopStartLabels.pop();
        this.loopEndLabels.pop();
    }

    // ============================================================================
    // Expression Compilation
    // ============================================================================

    private compileExpression(expr: Expression): void {
        switch (expr.kind) {
            case 'Literal':
                this.compileLiteral(expr);
                break;

            case 'Identifier':
                this.emit(ir(IROpcode.LOAD, expr.name, expr.span));
                break;

            case 'BinaryExpr':
                this.compileExpression(expr.left);
                this.compileExpression(expr.right);
                this.compileBinaryOp(expr.operator, expr.span);
                break;

            case 'UnaryExpr':
                this.compileExpression(expr.operand);
                this.compileUnaryOp(expr.operator, expr.span);
                break;

            case 'CallExpr':
                // Check if it's a standard library call: std.<method>(...)
                if (expr.callee.kind === 'MemberExpr' &&
                    expr.callee.object.kind === 'Identifier' &&
                    expr.callee.object.name === 'std') {

                    const method = expr.callee.property;
                    switch (method) {
                        case 'now':
                            this.emit(ir(IROpcode.CTX_BLOCK, 'timestamp', expr.span));
                            return;
                        case 'sender':
                            this.emit(ir(IROpcode.CTX_CALLER, undefined, expr.span));
                            return;
                        case 'hash':
                            if (expr.arguments.length !== 1) {
                                throw new Error('std.hash(data) expects 1 argument');
                            }
                            this.compileExpression(expr.arguments[0]!);
                            this.emit(ir(IROpcode.HASH, undefined, expr.span));
                            return;
                        default:
                            throw new Error(`Unknown std library function: ${method}`);
                    }
                }

                for (const arg of expr.arguments) {
                    this.compileExpression(arg);
                }
                if (expr.callee.kind === 'Identifier') {
                    this.emit(ir(IROpcode.CALL, expr.callee.name, expr.span));
                }
                break;

            case 'MemberExpr':
                this.compileExpression(expr.object);
                this.emit(ir(IROpcode.MEMBER_GET, expr.property, expr.span));
                break;

            case 'IndexExpr':
                this.compileExpression(expr.object);
                this.compileExpression(expr.index);
                this.emit(ir(IROpcode.LIST_GET, undefined, expr.span));
                break;

            case 'ContextExpr':
                switch (expr.context) {
                    case 'caller':
                        this.emit(ir(IROpcode.CTX_CALLER, undefined, expr.span));
                        break;
                    case 'block':
                        this.emit(ir(IROpcode.CTX_BLOCK, expr.property, expr.span));
                        break;
                    case 'this':
                        this.emit(ir(IROpcode.CTX_THIS, undefined, expr.span));
                        break;
                }
                break;

            case 'StateAccess':
                this.compileExpression(expr.key);
                if (expr.operation === 'get') {
                    this.emit(ir(IROpcode.STATE_GET, expr.stateType, expr.span));
                } else {
                    this.emit(ir(IROpcode.STATE_EXISTS, expr.stateType, expr.span));
                }
                break;

            case 'TernaryExpr':
                const elseLabel = this.newLabel('ternary_else');
                const endLabel = this.newLabel('ternary_end');
                this.compileExpression(expr.condition);
                this.emit(ir(IROpcode.JMP_IF_NOT, elseLabel));
                this.compileExpression(expr.consequent);
                this.emit(ir(IROpcode.JMP, endLabel));
                this.emitLabel(elseLabel);
                this.compileExpression(expr.alternate);
                this.emitLabel(endLabel);
                break;
        }
    }

    private compileLiteral(expr: Expression & { kind: 'Literal' }): void {
        let value: IRValue;
        switch (expr.literalType) {
            case 'integer':
                value = { kind: 'int', value: BigInt(expr.value as string | bigint) };
                break;
            case 'boolean':
                value = { kind: 'bool', value: expr.value as boolean };
                break;
            case 'string':
                value = { kind: 'string', value: expr.value as string };
                break;
            case 'bytes':
                // Parse hex string to bytes
                const hexStr = (expr.value as string).slice(2); // Remove 0x
                const bytes = new Uint8Array(hexStr.length / 2);
                for (let i = 0; i < bytes.length; i++) {
                    bytes[i] = parseInt(hexStr.slice(i * 2, i * 2 + 2), 16);
                }
                value = { kind: 'bytes', value: bytes };
                break;
        }
        this.emit(ir(IROpcode.PUSH, value, expr.span));
    }

    private compileBinaryOp(op: string, span?: import('../lexer/tokens.js').SourceSpan): void {
        const opcodeMap: Record<string, IROpcode> = {
            '+': IROpcode.ADD,
            '-': IROpcode.SUB,
            '*': IROpcode.MUL,
            '/': IROpcode.DIV,
            '%': IROpcode.MOD,
            '==': IROpcode.EQ,
            '!=': IROpcode.NEQ,
            '<': IROpcode.LT,
            '<=': IROpcode.LTE,
            '>': IROpcode.GT,
            '>=': IROpcode.GTE,
            '&&': IROpcode.AND,
            '||': IROpcode.OR,
            'and': IROpcode.AND,
            'or': IROpcode.OR,
        };
        const opcode = opcodeMap[op];
        if (opcode) {
            this.emit(ir(opcode, undefined, span));
        }
    }

    private compileUnaryOp(op: string, span?: import('../lexer/tokens.js').SourceSpan): void {
        switch (op) {
            case '-':
                this.emit(ir(IROpcode.NEG, undefined, span));
                break;
            case '!':
            case 'not':
                this.emit(ir(IROpcode.NOT, undefined, span));
                break;
        }
    }

    private compileAssignmentTarget(target: Expression): void {
        if (target.kind === 'Identifier') {
            this.emit(ir(IROpcode.STORE, target.name, target.span));
        } else if (target.kind === 'MemberExpr') {
            this.compileExpression(target.object);
            this.emit(ir(IROpcode.MEMBER_SET, target.property, target.span));
        } else if (target.kind === 'IndexExpr') {
            this.compileExpression(target.object);
            this.compileExpression(target.index);
            this.emit(ir(IROpcode.LIST_SET, undefined, target.span));
        } else if (target.kind === 'StateAccess') {
            this.compileExpression(target.key);
            this.emit(ir(IROpcode.STATE_SET, target.stateType, target.span));
        }
    }

    private compileDeleteTarget(target: Expression): void {
        if (target.kind === 'StateAccess') {
            this.compileExpression(target.key);
            this.emit(ir(IROpcode.STATE_DEL, target.stateType, target.span));
        } else if (target.kind === 'IndexExpr') {
            this.compileExpression(target.object);
            this.compileExpression(target.index);
            this.emit(ir(IROpcode.MAP_DEL, undefined, target.span));
        }
    }

    // ============================================================================
    // Helper Methods
    // ============================================================================

    private emit(instruction: IRInstruction): void {
        if (this.currentFunction) {
            this.currentFunction.instructions.push(instruction);
        }
    }

    private emitLabel(label: string): void {
        // Labels are stored as NOP instructions with the label as operand
        this.emit(ir(IROpcode.NOP, `@${label}`));
    }

    private newLabel(prefix: string): string {
        return `${prefix}_${this.labelCounter++}`;
    }

    private declareLocal(name: string): void {
        if (!this.locals.has(name)) {
            this.locals.set(name, this.locals.size);
        }
    }

    private typeToString(typeNode: import('../ast/nodes.js').TypeNode): string {
        switch (typeNode.kind) {
            case 'PrimitiveType':
                return typeNode.bits ? `${typeNode.name}<${typeNode.bits}>` : typeNode.name;
            case 'AddressType':
                return 'Address';
            case 'FixedType':
                return `Fixed<${typeNode.precision},${typeNode.scale}>`;
            case 'ListType':
                return `List<${this.typeToString(typeNode.elementType)}>`;
            case 'MapType':
                return `Map<${this.typeToString(typeNode.keyType)},${this.typeToString(typeNode.valueType)}>`;
            case 'OptionalType':
                return `Optional<${this.typeToString(typeNode.innerType)}>`;
            case 'NamedType':
                return typeNode.module ? `${typeNode.module}::${typeNode.name}` : typeNode.name;
        }
    }
}

// ============================================================================
// Convenience Function
// ============================================================================

/**
 * Compiles a module to IR
 */
export function compileToIR(module: Module): IRProgram {
    return new IRCompiler().compile(module);
}
