/**
 * Parser Tests
 */
import { describe, it, expect } from 'vitest';
import { parse, parseExpression, ParserError } from '../src/parser/index.js';

describe('Parser', () => {
    describe('Module Parsing', () => {
        it('parses module with entity', () => {
            const source = `
module Assets
public entity Asset[Address] {
  owner: Address,
  balance: UInt,
}`.trim();
            const module = parse(source);
            expect(module.name).toBe('Assets');
            expect(module.declarations).toHaveLength(1);
            expect(module.declarations[0]?.kind).toBe('EntityDeclaration');
        });

        it('parses module with transaction', () => {
            const source = `
module Transfer
public transaction Send(recipient: Address, amount: UInt) {
  require caller != recipient;
  let balance = 100;
}`.trim();
            const module = parse(source);
            expect(module.declarations).toHaveLength(1);
            expect(module.declarations[0]?.kind).toBe('TransactionDeclaration');
        });
    });

    describe('Type Parsing', () => {
        it('parses primitive types', () => {
            const source = `
module Types
entity Test[UInt] {
  a: Bool,
  b: String,
  c: Address,
}`.trim();
            const module = parse(source);
            const entity = module.declarations[0];
            expect(entity?.kind).toBe('EntityDeclaration');
        });

        it('parses generic types', () => {
            const source = `
module Types
entity Test[Address] {
  items: List<UInt>,
  data: Map<Address, UInt>,
  opt: Optional<String>,
}`.trim();
            const module = parse(source);
            expect(module.declarations).toHaveLength(1);
        });
    });

    describe('Expression Parsing', () => {
        it('parses literals', () => {
            expect(parseExpression('123').kind).toBe('Literal');
            expect(parseExpression('"hello"').kind).toBe('Literal');
            expect(parseExpression('true').kind).toBe('Literal');
            expect(parseExpression('false').kind).toBe('Literal');
        });

        it('parses identifiers', () => {
            const expr = parseExpression('myVar');
            expect(expr.kind).toBe('Identifier');
            if (expr.kind === 'Identifier') {
                expect(expr.name).toBe('myVar');
            }
        });

        it('parses binary expressions', () => {
            const expr = parseExpression('1 + 2');
            expect(expr.kind).toBe('BinaryExpr');
            if (expr.kind === 'BinaryExpr') {
                expect(expr.operator).toBe('+');
            }
        });

        it('parses operator precedence correctly', () => {
            const expr = parseExpression('1 + 2 * 3');
            expect(expr.kind).toBe('BinaryExpr');
            if (expr.kind === 'BinaryExpr') {
                expect(expr.operator).toBe('+');
                expect(expr.right.kind).toBe('BinaryExpr');
            }
        });

        it('parses comparison expressions', () => {
            const expr = parseExpression('x > 0');
            expect(expr.kind).toBe('BinaryExpr');
            if (expr.kind === 'BinaryExpr') {
                expect(expr.operator).toBe('>');
            }
        });

        it('parses logical expressions', () => {
            const expr = parseExpression('a && b || c');
            expect(expr.kind).toBe('BinaryExpr');
        });

        it('parses unary expressions', () => {
            const expr = parseExpression('!flag');
            expect(expr.kind).toBe('UnaryExpr');
        });

        it('parses member access', () => {
            const expr = parseExpression('obj.field');
            expect(expr.kind).toBe('MemberExpr');
        });

        it('parses function calls', () => {
            const expr = parseExpression('func(a, b)');
            expect(expr.kind).toBe('CallExpr');
        });

        it('parses index access', () => {
            const expr = parseExpression('arr[0]');
            expect(expr.kind).toBe('IndexExpr');
        });

        it('parses context expressions', () => {
            expect(parseExpression('caller').kind).toBe('ContextExpr');
            expect(parseExpression('block.timestamp').kind).toBe('ContextExpr');
        });

        it('parses state access', () => {
            const expr = parseExpression('get<Asset>(key)');
            expect(expr.kind).toBe('StateAccess');
            if (expr.kind === 'StateAccess') {
                expect(expr.operation).toBe('get');
                expect(expr.stateType).toBe('Asset');
            }
        });
    });

    describe('Statement Parsing', () => {
        it('parses let statements', () => {
            const source = `
module Test
transaction Foo() {
  let x = 42;
  let y: UInt = 10;
}`.trim();
            const module = parse(source);
            const tx = module.declarations[0];
            if (tx?.kind === 'TransactionDeclaration') {
                expect(tx.body).toHaveLength(2);
                expect(tx.body[0]?.kind).toBe('LetStatement');
            }
        });

        it('parses if statements', () => {
            const source = `
module Test
transaction Foo() {
  if x > 0 {
    let y = 1;
  } else {
    let y = 2;
  }
}`.trim();
            const module = parse(source);
            const tx = module.declarations[0];
            if (tx?.kind === 'TransactionDeclaration') {
                expect(tx.body[0]?.kind).toBe('IfStatement');
            }
        });

        it('parses for loops', () => {
            const source = `
module Test
transaction Foo() {
  for item in items {
    let x = item;
  }
}`.trim();
            const module = parse(source);
            const tx = module.declarations[0];
            if (tx?.kind === 'TransactionDeclaration') {
                expect(tx.body[0]?.kind).toBe('ForStatement');
            }
        });

        it('parses require statements', () => {
            const source = `
module Test
transaction Foo() {
  require balance > 0, "Insufficient balance";
}`.trim();
            const module = parse(source);
            const tx = module.declarations[0];
            if (tx?.kind === 'TransactionDeclaration') {
                expect(tx.body[0]?.kind).toBe('RequireStatement');
            }
        });

        it('parses emit statements', () => {
            const source = `
module Test
transaction Foo() {
  emit Transfer(sender, recipient, amount);
}`.trim();
            const module = parse(source);
            const tx = module.declarations[0];
            if (tx?.kind === 'TransactionDeclaration') {
                expect(tx.body[0]?.kind).toBe('EmitStatement');
            }
        });
    });

    describe('Error Handling', () => {
        it('throws on missing module name', () => {
            expect(() => parse('module')).toThrow(ParserError);
        });

        it('includes location in error', () => {
            try {
                parse('module Test { }');
            } catch (e) {
                if (e instanceof ParserError) {
                    expect(e.token).toBeDefined();
                }
            }
        });
    });
});
