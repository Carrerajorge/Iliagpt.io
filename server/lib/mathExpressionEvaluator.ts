/**
 * Deterministic arithmetic expression evaluator for trusted math input.
 *
 * This module avoids eval / Function entirely and only allows:
 * - numeric literals (including scientific notation),
 * - identifiers for constants and functions,
 * - operators +, -, *, /, %, **,
 * - parentheses and commas for function arguments.
 *
 * It intentionally rejects everything else and enforces hard ceilings
 * to reduce denial-of-service and parser abuse.
 */

export interface MathFunctionSpec {
  readonly fn: (...args: number[]) => number;
  readonly minArity: number;
  readonly maxArity?: number;
}

export type MathFunctionRegistry = Record<string, MathFunctionSpec>;

export interface MathExpressionEvaluationOptions {
  readonly maxExpressionLength?: number;
  readonly maxTokenCount?: number;
  readonly maxDepth?: number;
  readonly maxOperations?: number;
  readonly functions?: MathFunctionRegistry;
  readonly constants?: Record<string, number>;
}

type TokenType = "number" | "identifier" | "operator" | "comma" | "lparen" | "rparen";

interface BaseToken {
  readonly type: TokenType;
  readonly value: string;
  readonly position: number;
}

interface NumberToken extends BaseToken {
  readonly type: "number";
  readonly numeric: number;
}

type Token = BaseToken | NumberToken;

const DEFAULT_MAX_EXPRESSION_LENGTH = 2048;
const DEFAULT_MAX_TOKEN_COUNT = 512;
const DEFAULT_MAX_DEPTH = 64;
const DEFAULT_MAX_OPERATIONS = 1024;
const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function isNullish(value: unknown): value is null | undefined {
  return value === null || value === undefined;
}

function normalizeConstants(
  constants: Record<string, number> | undefined
): Record<string, number> {
  const normalized: Record<string, number> = {};
  if (isNullish(constants)) {
    return normalized;
  }

  for (const [name, rawValue] of Object.entries(constants)) {
    if (!IDENTIFIER_RE.test(name)) {
      throw new Error(`Invalid constant name: ${name}`);
    }
    if (!Number.isFinite(rawValue)) {
      throw new Error(`Invalid constant value for ${name}`);
    }
    if (name === "__proto__" || name === "constructor" || name === "prototype") {
      throw new Error(`Disallowed constant name: ${name}`);
    }
    normalized[name] = rawValue;
  }

  if (!Number.isFinite(normalized.pi) && !Number.isFinite(normalized.PI)) {
    normalized.pi = Math.PI;
    normalized.PI = Math.PI;
  }
  if (!Number.isFinite(normalized.e) && !Number.isFinite(normalized.E)) {
    normalized.e = Math.E;
    normalized.E = Math.E;
  }

  return normalized;
}

function normalizeFunctions(functions: MathFunctionRegistry | undefined): MathFunctionRegistry {
  const normalized: MathFunctionRegistry = {};
  if (isNullish(functions)) {
    return normalized;
  }

  for (const [name, definition] of Object.entries(functions)) {
    if (!IDENTIFIER_RE.test(name)) {
      throw new Error(`Invalid function name: ${name}`);
    }
    if (!definition || typeof definition.fn !== "function") {
      throw new Error(`Invalid function definition for ${name}`);
    }
    if (!Number.isInteger(definition.minArity) || definition.minArity < 0) {
      throw new Error(`Invalid function arity for ${name}`);
    }
    if (definition.maxArity !== undefined) {
      if (!Number.isInteger(definition.maxArity) || definition.maxArity < definition.minArity) {
        throw new Error(`Invalid max arity for ${name}`);
      }
    }
    if (name === "__proto__" || name === "constructor" || name === "prototype") {
      throw new Error(`Disallowed function name: ${name}`);
    }
    normalized[name] = {
      fn: definition.fn,
      minArity: definition.minArity,
      maxArity: definition.maxArity,
    };
  }

  return normalized;
}

function tokenize(expression: string, options: { maxTokenCount: number }): Token[] {
  const tokenized: Token[] = [];
  const length = expression.length;
  let i = 0;

  const numberRegex = /^(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?/;
  const identifierRegex = /^[A-Za-z_][A-Za-z0-9_]*/;

  while (i < length) {
    if (tokenized.length >= options.maxTokenCount) {
      throw new Error("Expression has too many tokens");
    }

    const ch = expression[i];

    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }

    if (ch === "(") {
      tokenized.push({ type: "lparen", value: "(", position: i });
      i += 1;
      continue;
    }

    if (ch === ")") {
      tokenized.push({ type: "rparen", value: ")", position: i });
      i += 1;
      continue;
    }

    if (ch === ",") {
      tokenized.push({ type: "comma", value: ",", position: i });
      i += 1;
      continue;
    }

    if (expression.startsWith("**", i)) {
      tokenized.push({ type: "operator", value: "**", position: i });
      i += 2;
      continue;
    }

    if ("+-*/%".includes(ch)) {
      tokenized.push({ type: "operator", value: ch, position: i });
      i += 1;
      continue;
    }

    const numberMatch = numberRegex.exec(expression.slice(i));
    if (numberMatch) {
      const raw = numberMatch[0];
      const numeric = Number(raw);
      if (!Number.isFinite(numeric)) {
        throw new Error(`Invalid numeric literal at position ${i}: ${raw}`);
      }
      tokenized.push({
        type: "number",
        value: raw,
        position: i,
        numeric,
      });
      i += raw.length;
      continue;
    }

    const idMatch = identifierRegex.exec(expression.slice(i));
    if (idMatch) {
      tokenized.push({ type: "identifier", value: idMatch[0], position: i });
      i += idMatch[0].length;
      continue;
    }

    throw new Error(`Unexpected token at position ${i}: ${ch}`);
  }

  return tokenized;
}

class ExpressionParser {
  private index = 0;
  private operationCount = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly functions: MathFunctionRegistry,
    private readonly constants: Record<string, number>,
    private readonly maxDepth: number = DEFAULT_MAX_DEPTH,
    private readonly maxOperations: number = DEFAULT_MAX_OPERATIONS
  ) {}

  parse(depth: number = 1): number {
    if (depth > this.maxDepth) {
      throw new Error("Expression nesting exceeds safety limits");
    }
    const value = this.parseExpression(depth);
    if (this.hasMoreTokens()) {
      const token = this.peek();
      throw new Error(`Unexpected token '${token?.value ?? "EOF"}' at position ${token?.position ?? "unknown"}`);
    }
    return value;
  }

  private parseExpression(depth: number): number {
    if (depth > this.maxDepth) {
      throw new Error("Expression nesting exceeds safety limits");
    }
    let lhs = this.parseTerm(depth + 1);
    while (this.matchOperator(["+", "-"])) {
      const operator = this.consume().value;
      const rhs = this.parseTerm(depth + 1);
      lhs = this.applyBinary(operator, lhs, rhs);
    }
    return lhs;
  }

  private parseTerm(depth: number): number {
    let lhs = this.parsePower(depth + 1);
    while (this.matchOperator(["*", "/", "%"])) {
      const operator = this.consume().value;
      const rhs = this.parsePower(depth + 1);
      lhs = this.applyBinary(operator, lhs, rhs);
    }
    return lhs;
  }

  private parsePower(depth: number): number {
    let lhs = this.parseUnary(depth);
    if (this.matchOperator(["**"])) {
      this.consume();
      const rhs = this.parsePower(depth);
      lhs = this.applyBinaryPower(lhs, rhs);
      this.ensureOperationBudget();
    }
    return lhs;
  }

  private parseUnary(depth: number): number {
    if (depth > this.maxDepth) {
      throw new Error("Expression nesting exceeds safety limits");
    }

    if (this.matchOperator(["+"])) {
      this.consume();
      return +this.parseUnary(depth + 1);
    }
    if (this.matchOperator(["-"])) {
      this.consume();
      return -this.parseUnary(depth + 1);
    }
    return this.parsePrimary(depth + 1);
  }

  private parsePrimary(depth: number): number {
    const token = this.peek();
    if (!token) {
      throw new Error("Unexpected end of expression");
    }

    if (token.type === "number") {
      this.consume();
      return token.numeric;
    }

    if (token.type === "lparen") {
      this.consume();
      const inner = this.parseExpression(depth + 1);
      this.consumeExpected("rparen", "Expected ')' after grouped expression");
      return inner;
    }

    if (token.type === "identifier") {
      return this.parseIdentifier(depth);
    }

    throw new Error(`Unexpected token '${token.value}' at position ${token.position}`);
  }

  private parseIdentifier(depth: number): number {
    const identifier = this.consume();
    const name = identifier.value;

    if (!this.matches("lparen")) {
      const constant = this.constants[name];
      if (!Number.isFinite(constant)) {
        throw new Error(`Unknown identifier: ${name}`);
      }
      return constant;
    }

    const fn = this.functions[name];
    if (!fn) {
      throw new Error(`Unknown function: ${name}`);
    }
    if (depth > this.maxDepth) {
      throw new Error("Expression nesting exceeds safety limits");
    }

    this.consumeExpected("lparen", "Expected '(' after function name");
    const args = this.parseArgumentList(depth + 1);
    this.consumeExpected("rparen", "Expected ')' after function arguments");

    if (args.length < fn.minArity) {
      throw new Error(`Function ${name} requires at least ${fn.minArity} arguments`);
    }
    if (fn.maxArity !== undefined && args.length > fn.maxArity) {
      throw new Error(`Function ${name} accepts at most ${fn.maxArity} arguments`);
    }
    const value = fn.fn(...args);
    if (!Number.isFinite(value)) {
      throw new Error(`Function ${name} produced non-finite value`);
    }

    this.ensureOperationBudget();
    return value;
  }

  private parseArgumentList(depth: number): number[] {
    const args: number[] = [];
    if (this.matches("rparen")) {
      return args;
    }
    while (true) {
      const value = this.parseExpression(depth);
      args.push(value);
      if (!this.matches("comma")) {
        break;
      }
      this.consume();
    }
    return args;
  }

  private applyBinary(operator: string, lhs: number, rhs: number): number {
    this.ensureOperationBudget();
    let value: number;
    switch (operator) {
      case "+":
        value = lhs + rhs;
        break;
      case "-":
        value = lhs - rhs;
        break;
      case "*":
        value = lhs * rhs;
        break;
      case "/":
        if (rhs === 0) {
          throw new Error("Division by zero");
        }
        value = lhs / rhs;
        break;
      case "%":
        if (rhs === 0) {
          throw new Error("Modulo by zero");
        }
        value = lhs % rhs;
        break;
      default:
        throw new Error(`Unsupported operator: ${operator}`);
    }
    if (!Number.isFinite(value)) {
      throw new Error(`Operation produced non-finite value`);
    }
    return value;
  }

  private applyBinaryPower(lhs: number, rhs: number): number {
    if (!Number.isFinite(rhs)) {
      throw new Error("Invalid exponent");
    }
    const value = lhs ** rhs;
    if (!Number.isFinite(value)) {
      throw new Error("Operation produced non-finite value");
    }
    return value;
  }

  private ensureOperationBudget(): void {
    this.operationCount += 1;
    if (this.operationCount > this.maxOperations) {
      throw new Error("Expression exceeds operation budget");
    }
  }

  private hasMoreTokens(): boolean {
    return this.index < this.tokens.length;
  }

  private peek(): Token | undefined {
    return this.tokens[this.index];
  }

  private matchOperator(expected: string[]): boolean {
    const token = this.peek();
    return (
      token?.type === "operator" &&
      expected.some((value) => token.value === value)
    );
  }

  private matches(type: TokenType): boolean {
    return this.peek()?.type === type;
  }

  private consume(): Token {
    const token = this.peek();
    if (!token) {
      throw new Error("Unexpected end of expression");
    }
    this.index += 1;
    return token;
  }

  private consumeExpected(type: TokenType, message: string): void {
    const token = this.peek();
    if (!token || token.type !== type) {
      throw new Error(message);
    }
    this.consume();
  }
}

function ensureTokenLimit(expression: string, maxExpressionLength: number): string {
  if (typeof expression !== "string") {
    throw new Error("Expression must be a string");
  }
  const normalized = expression.normalize("NFC").trim();
  if (normalized.length === 0) {
    throw new Error("Expression cannot be empty");
  }
  if (normalized.length > maxExpressionLength) {
    throw new Error("Expression exceeds allowed length");
  }
  return normalized;
}

export function evaluateSafeMathExpression(
  rawExpression: string,
  options: MathExpressionEvaluationOptions = {}
): number {
  const maxExpressionLength = options.maxExpressionLength ?? DEFAULT_MAX_EXPRESSION_LENGTH;
  const maxTokenCount = options.maxTokenCount ?? DEFAULT_MAX_TOKEN_COUNT;
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxOperations = options.maxOperations ?? DEFAULT_MAX_OPERATIONS;

  const expression = ensureTokenLimit(rawExpression, maxExpressionLength);
  const functions = normalizeFunctions(options.functions);
  const constants = normalizeConstants(options.constants);

  const tokens = tokenize(expression, { maxTokenCount });
  if (tokens.length === 0) {
    throw new Error("Expression cannot be empty");
  }

  const parser = new ExpressionParser(tokens, functions, constants, maxDepth, maxOperations);
  return parser.parse();
}
