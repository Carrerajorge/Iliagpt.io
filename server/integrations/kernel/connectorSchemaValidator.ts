/**
 * connectorSchemaValidator.ts
 *
 * Schema validation and contract testing for connector APIs.
 * Provides JSON Schema 7 validation, contract testing, schema evolution
 * tracking, and response shape guarding.
 */

const schemaCrypto = require("crypto");

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface ValidationError {
  path: string;
  message: string;
  keyword: string;
  params?: Record<string, unknown>;
  schemaPath?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  errorCount: number;
  validatedAt: number;
}

export interface ContractTest {
  id: string;
  connectorId: string;
  name: string;
  description?: string;
  endpoint: string;
  method: string;
  requestSchema?: Record<string, unknown>;
  responseSchema: Record<string, unknown>;
  expectedStatus?: number;
  timeout?: number;
  tags?: string[];
  createdAt: number;
  updatedAt: number;
}

export interface ContractTestResult {
  testId: string;
  connectorId: string;
  name: string;
  passed: boolean;
  errors: ValidationError[];
  durationMs: number;
  executedAt: number;
  responseStatus?: number;
  responseBody?: unknown;
}

export interface SchemaChange {
  connectorId: string;
  endpoint: string;
  changeType:
    | "field_added"
    | "field_removed"
    | "type_changed"
    | "required_added"
    | "required_removed"
    | "enum_changed";
  path: string;
  oldValue?: unknown;
  newValue?: unknown;
  breaking: boolean;
  detectedAt: number;
}

export interface ResponseShapeReport {
  connectorId: string;
  endpoint: string;
  shapeScore: number;
  expectedFields: string[];
  actualFields: string[];
  missingFields: string[];
  extraFields: string[];
  typeMatches: number;
  typeMismatches: number;
  checkedAt: number;
}

/* ------------------------------------------------------------------ */
/*  SchemaValidator                                                    */
/* ------------------------------------------------------------------ */

export class SchemaValidator {
  private formatValidators: Map<string, (value: string) => boolean>;
  private validationCount: number;
  private errorCount: number;

  constructor() {
    this.formatValidators = new Map();
    this.validationCount = 0;
    this.errorCount = 0;

    // Register built-in format validators
    this.registerFormat("email", (v) =>
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)
    );
    this.registerFormat("uri", (v) => {
      try {
        new URL(v);
        return true;
      } catch {
        return false;
      }
    });
    this.registerFormat("date", (v) =>
      /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v))
    );
    this.registerFormat("date-time", (v) => !isNaN(Date.parse(v)));
    this.registerFormat("ipv4", (v) =>
      /^(\d{1,3}\.){3}\d{1,3}$/.test(v) &&
        v.split(".").every((n: string) => parseInt(n, 10) >= 0 && parseInt(n, 10) <= 255)
    );
    this.registerFormat("ipv6", (v) => /^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/.test(v));
    this.registerFormat("uuid", (v) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
    );
    this.registerFormat("hostname", (v) =>
      /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*$/.test(v)
    );
  }

  /**
   * Register a custom format validator.
   */
  registerFormat(name: string, validator: (value: string) => boolean): void {
    this.formatValidators.set(name, validator);
  }

  /**
   * Validate data against a JSON Schema 7 schema.
   */
  validate(data: unknown, schema: Record<string, unknown>, rootPath = ""): ValidationResult {
    this.validationCount++;
    const errors: ValidationError[] = [];
    this.validateNode(data, schema, rootPath || "#", errors);

    if (errors.length > 0) {
      this.errorCount += errors.length;
    }

    return {
      valid: errors.length === 0,
      errors,
      errorCount: errors.length,
      validatedAt: Date.now(),
    };
  }

  /**
   * Recursive validation of a schema node.
   */
  private validateNode(
    data: unknown,
    schema: Record<string, unknown>,
    path: string,
    errors: ValidationError[]
  ): void {
    // Handle $ref (simplified — no actual dereferencing)
    if (schema.$ref) {
      return;
    }

    // Handle allOf
    if (Array.isArray(schema.allOf)) {
      for (const subSchema of schema.allOf) {
        this.validateNode(data, subSchema as Record<string, unknown>, path, errors);
      }
      return;
    }

    // Handle anyOf
    if (Array.isArray(schema.anyOf)) {
      const subErrors: ValidationError[][] = [];
      let anyValid = false;
      for (const subSchema of schema.anyOf) {
        const subResult: ValidationError[] = [];
        this.validateNode(data, subSchema as Record<string, unknown>, path, subResult);
        if (subResult.length === 0) {
          anyValid = true;
          break;
        }
        subErrors.push(subResult);
      }
      if (!anyValid) {
        errors.push({
          path,
          message: `Value does not match any of the allowed schemas`,
          keyword: "anyOf",
        });
      }
      return;
    }

    // Handle oneOf
    if (Array.isArray(schema.oneOf)) {
      let matchCount = 0;
      for (const subSchema of schema.oneOf) {
        const subResult: ValidationError[] = [];
        this.validateNode(data, subSchema as Record<string, unknown>, path, subResult);
        if (subResult.length === 0) matchCount++;
      }
      if (matchCount !== 1) {
        errors.push({
          path,
          message: `Value must match exactly one of the schemas (matched ${matchCount})`,
          keyword: "oneOf",
          params: { matchCount },
        });
      }
      return;
    }

    // Handle not
    if (schema.not) {
      const subResult: ValidationError[] = [];
      this.validateNode(data, schema.not as Record<string, unknown>, path, subResult);
      if (subResult.length === 0) {
        errors.push({
          path,
          message: `Value should NOT match the schema`,
          keyword: "not",
        });
      }
      return;
    }

    // Handle const
    if ("const" in schema) {
      if (JSON.stringify(data) !== JSON.stringify(schema.const)) {
        errors.push({
          path,
          message: `Value must be ${JSON.stringify(schema.const)}`,
          keyword: "const",
          params: { expected: schema.const },
        });
      }
      return;
    }

    // Handle nullable
    if (data === null) {
      if (schema.nullable === true) return;
      if (schema.type && schema.type !== "null") {
        errors.push({
          path,
          message: `Value must not be null`,
          keyword: "type",
          params: { expected: schema.type },
        });
      }
      return;
    }

    if (data === undefined) {
      // Handled by required check at parent level
      return;
    }

    // Type checking
    const schemaType = schema.type as string | string[] | undefined;
    if (schemaType) {
      const types = Array.isArray(schemaType) ? schemaType : [schemaType];
      const actualType = this.getJsonType(data);
      if (!types.includes(actualType) && !(types.includes("null") && data === null)) {
        errors.push({
          path,
          message: `Expected type '${types.join("|")}', got '${actualType}'`,
          keyword: "type",
          params: { expected: types, actual: actualType },
        });
        return; // No point checking further constraints
      }
    }

    // String validations
    if (typeof data === "string") {
      this.validateString(data, schema, path, errors);
    }

    // Number validations
    if (typeof data === "number") {
      this.validateNumber(data, schema, path, errors);
    }

    // Array validations
    if (Array.isArray(data)) {
      this.validateArray(data, schema, path, errors);
    }

    // Object validations
    if (typeof data === "object" && data !== null && !Array.isArray(data)) {
      this.validateObject(data as Record<string, unknown>, schema, path, errors);
    }

    // Enum validation
    if (Array.isArray(schema.enum)) {
      const enumVals = schema.enum as unknown[];
      const found = enumVals.some(
        (e) => JSON.stringify(e) === JSON.stringify(data)
      );
      if (!found) {
        errors.push({
          path,
          message: `Value must be one of: ${enumVals.map((e) => JSON.stringify(e)).join(", ")}`,
          keyword: "enum",
          params: { allowed: enumVals },
        });
      }
    }
  }

  /**
   * Validate string-specific constraints.
   */
  private validateString(
    data: string,
    schema: Record<string, unknown>,
    path: string,
    errors: ValidationError[]
  ): void {
    if (typeof schema.minLength === "number" && data.length < schema.minLength) {
      errors.push({
        path,
        message: `String must be at least ${schema.minLength} characters`,
        keyword: "minLength",
        params: { minLength: schema.minLength, actual: data.length },
      });
    }
    if (typeof schema.maxLength === "number" && data.length > schema.maxLength) {
      errors.push({
        path,
        message: `String must be at most ${schema.maxLength} characters`,
        keyword: "maxLength",
        params: { maxLength: schema.maxLength, actual: data.length },
      });
    }
    if (typeof schema.pattern === "string") {
      try {
        const regex = new RegExp(schema.pattern);
        if (!regex.test(data)) {
          errors.push({
            path,
            message: `String does not match pattern: ${schema.pattern}`,
            keyword: "pattern",
            params: { pattern: schema.pattern },
          });
        }
      } catch {
        // Invalid regex in schema
      }
    }
    if (typeof schema.format === "string") {
      const validator = this.formatValidators.get(schema.format);
      if (validator && !validator(data)) {
        errors.push({
          path,
          message: `String does not match format '${schema.format}'`,
          keyword: "format",
          params: { format: schema.format },
        });
      }
    }
  }

  /**
   * Validate number-specific constraints.
   */
  private validateNumber(
    data: number,
    schema: Record<string, unknown>,
    path: string,
    errors: ValidationError[]
  ): void {
    if (typeof schema.minimum === "number" && data < schema.minimum) {
      errors.push({
        path,
        message: `Value ${data} is less than minimum ${schema.minimum}`,
        keyword: "minimum",
        params: { minimum: schema.minimum, actual: data },
      });
    }
    if (typeof schema.maximum === "number" && data > schema.maximum) {
      errors.push({
        path,
        message: `Value ${data} is greater than maximum ${schema.maximum}`,
        keyword: "maximum",
        params: { maximum: schema.maximum, actual: data },
      });
    }
    if (typeof schema.exclusiveMinimum === "number" && data <= schema.exclusiveMinimum) {
      errors.push({
        path,
        message: `Value ${data} must be greater than ${schema.exclusiveMinimum}`,
        keyword: "exclusiveMinimum",
        params: { exclusiveMinimum: schema.exclusiveMinimum },
      });
    }
    if (typeof schema.exclusiveMaximum === "number" && data >= schema.exclusiveMaximum) {
      errors.push({
        path,
        message: `Value ${data} must be less than ${schema.exclusiveMaximum}`,
        keyword: "exclusiveMaximum",
        params: { exclusiveMaximum: schema.exclusiveMaximum },
      });
    }
    if (typeof schema.multipleOf === "number" && schema.multipleOf > 0) {
      const remainder = data % schema.multipleOf;
      if (Math.abs(remainder) > 1e-10) {
        errors.push({
          path,
          message: `Value ${data} must be a multiple of ${schema.multipleOf}`,
          keyword: "multipleOf",
          params: { multipleOf: schema.multipleOf },
        });
      }
    }
    if (schema.type === "integer" && !Number.isInteger(data)) {
      errors.push({
        path,
        message: `Value must be an integer`,
        keyword: "type",
        params: { expected: "integer" },
      });
    }
  }

  /**
   * Validate array-specific constraints.
   */
  private validateArray(
    data: unknown[],
    schema: Record<string, unknown>,
    path: string,
    errors: ValidationError[]
  ): void {
    if (typeof schema.minItems === "number" && data.length < schema.minItems) {
      errors.push({
        path,
        message: `Array must have at least ${schema.minItems} items`,
        keyword: "minItems",
        params: { minItems: schema.minItems, actual: data.length },
      });
    }
    if (typeof schema.maxItems === "number" && data.length > schema.maxItems) {
      errors.push({
        path,
        message: `Array must have at most ${schema.maxItems} items`,
        keyword: "maxItems",
        params: { maxItems: schema.maxItems, actual: data.length },
      });
    }
    if (schema.uniqueItems === true) {
      const seen = new Set<string>();
      for (let i = 0; i < data.length; i++) {
        const key = JSON.stringify(data[i]);
        if (seen.has(key)) {
          errors.push({
            path: `${path}[${i}]`,
            message: `Array must contain unique items (duplicate at index ${i})`,
            keyword: "uniqueItems",
          });
          break;
        }
        seen.add(key);
      }
    }

    // Validate items
    if (schema.items && typeof schema.items === "object") {
      if (Array.isArray(schema.items)) {
        // Tuple validation
        for (let i = 0; i < data.length; i++) {
          const itemSchema = (schema.items as Record<string, unknown>[])[i];
          if (itemSchema) {
            this.validateNode(data[i], itemSchema, `${path}[${i}]`, errors);
          } else if (schema.additionalItems === false) {
            errors.push({
              path: `${path}[${i}]`,
              message: `Additional items not allowed`,
              keyword: "additionalItems",
            });
          } else if (
            schema.additionalItems &&
            typeof schema.additionalItems === "object"
          ) {
            this.validateNode(
              data[i],
              schema.additionalItems as Record<string, unknown>,
              `${path}[${i}]`,
              errors
            );
          }
        }
      } else {
        // All items must match the schema
        for (let i = 0; i < data.length; i++) {
          this.validateNode(
            data[i],
            schema.items as Record<string, unknown>,
            `${path}[${i}]`,
            errors
          );
        }
      }
    }

    // Contains validation
    if (schema.contains && typeof schema.contains === "object") {
      let found = false;
      for (let i = 0; i < data.length; i++) {
        const subErrors: ValidationError[] = [];
        this.validateNode(
          data[i],
          schema.contains as Record<string, unknown>,
          `${path}[${i}]`,
          subErrors
        );
        if (subErrors.length === 0) {
          found = true;
          break;
        }
      }
      if (!found) {
        errors.push({
          path,
          message: `Array must contain at least one matching item`,
          keyword: "contains",
        });
      }
    }
  }

  /**
   * Validate object-specific constraints.
   */
  private validateObject(
    data: Record<string, unknown>,
    schema: Record<string, unknown>,
    path: string,
    errors: ValidationError[]
  ): void {
    const dataKeys = Object.keys(data);

    // Required fields
    if (Array.isArray(schema.required)) {
      for (const reqField of schema.required as string[]) {
        if (!(reqField in data) || data[reqField] === undefined) {
          errors.push({
            path: `${path}.${reqField}`,
            message: `Required field '${reqField}' is missing`,
            keyword: "required",
            params: { required: reqField },
          });
        }
      }
    }

    // Min/max properties
    if (typeof schema.minProperties === "number" && dataKeys.length < schema.minProperties) {
      errors.push({
        path,
        message: `Object must have at least ${schema.minProperties} properties`,
        keyword: "minProperties",
        params: { minProperties: schema.minProperties, actual: dataKeys.length },
      });
    }
    if (typeof schema.maxProperties === "number" && dataKeys.length > schema.maxProperties) {
      errors.push({
        path,
        message: `Object must have at most ${schema.maxProperties} properties`,
        keyword: "maxProperties",
        params: { maxProperties: schema.maxProperties, actual: dataKeys.length },
      });
    }

    // Property validation
    const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
    const patternProperties = (schema.patternProperties ?? {}) as Record<
      string,
      Record<string, unknown>
    >;
    const additionalProperties = schema.additionalProperties;

    const validatedKeys = new Set<string>();

    // Validate known properties
    for (const [propName, propSchema] of Object.entries(properties)) {
      validatedKeys.add(propName);
      if (propName in data) {
        this.validateNode(data[propName], propSchema, `${path}.${propName}`, errors);
      }
    }

    // Validate pattern properties
    for (const [pattern, propSchema] of Object.entries(patternProperties)) {
      try {
        const regex = new RegExp(pattern);
        for (const key of dataKeys) {
          if (regex.test(key)) {
            validatedKeys.add(key);
            this.validateNode(data[key], propSchema, `${path}.${key}`, errors);
          }
        }
      } catch {
        // Invalid pattern
      }
    }

    // Additional properties check
    if (additionalProperties !== undefined) {
      for (const key of dataKeys) {
        if (!validatedKeys.has(key)) {
          if (additionalProperties === false) {
            errors.push({
              path: `${path}.${key}`,
              message: `Additional property '${key}' is not allowed`,
              keyword: "additionalProperties",
            });
          } else if (
            typeof additionalProperties === "object" &&
            additionalProperties !== null
          ) {
            this.validateNode(
              data[key],
              additionalProperties as Record<string, unknown>,
              `${path}.${key}`,
              errors
            );
          }
        }
      }
    }

    // Dependencies
    if (schema.dependencies && typeof schema.dependencies === "object") {
      for (const [depKey, depValue] of Object.entries(
        schema.dependencies as Record<string, unknown>
      )) {
        if (!(depKey in data)) continue;

        if (Array.isArray(depValue)) {
          // Property dependencies
          for (const reqProp of depValue) {
            if (!(reqProp in data)) {
              errors.push({
                path: `${path}.${reqProp}`,
                message: `Property '${reqProp}' is required when '${depKey}' is present`,
                keyword: "dependencies",
                params: { dependency: depKey, required: reqProp },
              });
            }
          }
        } else if (typeof depValue === "object" && depValue !== null) {
          // Schema dependency
          this.validateNode(data, depValue as Record<string, unknown>, path, errors);
        }
      }
    }

    // If-then-else
    if (schema.if && typeof schema.if === "object") {
      const ifErrors: ValidationError[] = [];
      this.validateNode(data, schema.if as Record<string, unknown>, path, ifErrors);
      if (ifErrors.length === 0 && schema.then && typeof schema.then === "object") {
        this.validateNode(data, schema.then as Record<string, unknown>, path, errors);
      } else if (ifErrors.length > 0 && schema.else && typeof schema.else === "object") {
        this.validateNode(data, schema.else as Record<string, unknown>, path, errors);
      }
    }
  }

  /**
   * Get the JSON Schema type of a JavaScript value.
   */
  private getJsonType(value: unknown): string {
    if (value === null) return "null";
    if (Array.isArray(value)) return "array";
    if (typeof value === "number") {
      return Number.isInteger(value) ? "integer" : "number";
    }
    return typeof value;
  }

  /**
   * Get validation statistics.
   */
  getStats(): { validationCount: number; errorCount: number } {
    return {
      validationCount: this.validationCount,
      errorCount: this.errorCount,
    };
  }

  /**
   * Reset statistics.
   */
  resetStats(): void {
    this.validationCount = 0;
    this.errorCount = 0;
  }
}

/* ------------------------------------------------------------------ */
/*  ContractTestRunner                                                 */
/* ------------------------------------------------------------------ */

export class ContractTestRunner {
  private tests: Map<string, ContractTest>;
  private results: ContractTestResult[];
  private readonly MAX_RESULTS = 2000;
  private validator: SchemaValidator;
  private mockResponses: Map<string, unknown>;

  constructor(validator?: SchemaValidator) {
    this.tests = new Map();
    this.results = [];
    this.validator = validator ?? new SchemaValidator();
    this.mockResponses = new Map();
  }

  /**
   * Register a contract test.
   */
  registerTest(test: ContractTest): void {
    this.tests.set(test.id, { ...test, updatedAt: Date.now() });
  }

  /**
   * Remove a contract test.
   */
  removeTest(testId: string): boolean {
    return this.tests.delete(testId);
  }

  /**
   * Set a mock response for testing without making actual HTTP calls.
   */
  setMockResponse(testId: string, response: unknown): void {
    this.mockResponses.set(testId, response);
  }

  /**
   * Run a single contract test.
   */
  async runTest(testId: string): Promise<ContractTestResult> {
    const test = this.tests.get(testId);
    if (!test) {
      throw new Error(`Contract test '${testId}' not found`);
    }

    const startTime = Date.now();
    let responseBody: unknown;
    let responseStatus: number | undefined;

    try {
      // Use mock response if available, otherwise indicate no HTTP client
      const mock = this.mockResponses.get(testId);
      if (mock !== undefined) {
        responseBody = mock;
        responseStatus = test.expectedStatus ?? 200;
      } else {
        // In real usage, this would make an HTTP call
        // For now, return a failure indicating no response available
        const result: ContractTestResult = {
          testId,
          connectorId: test.connectorId,
          name: test.name,
          passed: false,
          errors: [
            {
              path: "#",
              message: "No mock response provided and HTTP client not available",
              keyword: "contract",
            },
          ],
          durationMs: Date.now() - startTime,
          executedAt: Date.now(),
        };
        this.storeResult(result);
        return result;
      }

      // Validate response against schema
      const validation = this.validator.validate(responseBody, test.responseSchema);

      const errors: ValidationError[] = [...validation.errors];

      // Check status code
      if (test.expectedStatus && responseStatus !== test.expectedStatus) {
        errors.push({
          path: "#/status",
          message: `Expected status ${test.expectedStatus}, got ${responseStatus}`,
          keyword: "status",
          params: { expected: test.expectedStatus, actual: responseStatus },
        });
      }

      const result: ContractTestResult = {
        testId,
        connectorId: test.connectorId,
        name: test.name,
        passed: errors.length === 0,
        errors,
        durationMs: Date.now() - startTime,
        executedAt: Date.now(),
        responseStatus,
        responseBody,
      };

      this.storeResult(result);
      return result;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const result: ContractTestResult = {
        testId,
        connectorId: test.connectorId,
        name: test.name,
        passed: false,
        errors: [{ path: "#", message: `Test execution failed: ${msg}`, keyword: "execution" }],
        durationMs: Date.now() - startTime,
        executedAt: Date.now(),
      };
      this.storeResult(result);
      return result;
    }
  }

  /**
   * Run all tests for a connector.
   */
  async runConnectorTests(connectorId: string): Promise<ContractTestResult[]> {
    const connectorTests = Array.from(this.tests.values()).filter(
      (t) => t.connectorId === connectorId
    );
    const results: ContractTestResult[] = [];
    for (const test of connectorTests) {
      results.push(await this.runTest(test.id));
    }
    return results;
  }

  /**
   * Run all registered tests.
   */
  async runAll(): Promise<ContractTestResult[]> {
    const results: ContractTestResult[] = [];
    for (const test of Array.from(this.tests.values())) {
      results.push(await this.runTest(test.id));
    }
    return results;
  }

  /**
   * Get the pass rate across all results.
   */
  getPassRate(connectorId?: string): { total: number; passed: number; failed: number; rate: number } {
    let filtered = this.results;
    if (connectorId) {
      filtered = filtered.filter((r) => r.connectorId === connectorId);
    }
    const passed = filtered.filter((r) => r.passed).length;
    return {
      total: filtered.length,
      passed,
      failed: filtered.length - passed,
      rate: filtered.length > 0 ? (passed / filtered.length) * 100 : 0,
    };
  }

  /**
   * Get recent results.
   */
  getResults(connectorId?: string, limit = 50): ContractTestResult[] {
    let filtered = this.results;
    if (connectorId) {
      filtered = filtered.filter((r) => r.connectorId === connectorId);
    }
    return filtered.slice(-limit);
  }

  /**
   * Get all registered test IDs.
   */
  getTestIds(): string[] {
    return Array.from(this.tests.keys());
  }

  /**
   * Get a specific test definition.
   */
  getTest(testId: string): ContractTest | undefined {
    return this.tests.get(testId);
  }

  /**
   * Store a result with limit enforcement.
   */
  private storeResult(result: ContractTestResult): void {
    this.results.push(result);
    if (this.results.length > this.MAX_RESULTS) {
      this.results = this.results.slice(-this.MAX_RESULTS);
    }
  }
}

/* ------------------------------------------------------------------ */
/*  SchemaEvolutionTracker                                             */
/* ------------------------------------------------------------------ */

export class SchemaEvolutionTracker {
  private snapshots: Map<string, Array<{ schema: Record<string, unknown>; hash: string; timestamp: number }>>;
  private changes: SchemaChange[];
  private readonly MAX_SNAPSHOTS = 100;
  private readonly MAX_CHANGES = 5000;

  constructor() {
    this.snapshots = new Map();
    this.changes = [];
  }

  /**
   * Take a snapshot of a schema.
   */
  takeSnapshot(connectorId: string, endpoint: string, schema: Record<string, unknown>): string {
    const key = `${connectorId}:${endpoint}`;
    const schemaStr = JSON.stringify(schema, null, 2);
    const hash = schemaCrypto.createHash("sha256").update(schemaStr).digest("hex");

    let snaps = this.snapshots.get(key);
    if (!snaps) {
      snaps = [];
      this.snapshots.set(key, snaps);
    }

    // Skip if identical to last snapshot
    if (snaps.length > 0 && snaps[snaps.length - 1].hash === hash) {
      return hash;
    }

    snaps.push({
      schema: JSON.parse(schemaStr),
      hash,
      timestamp: Date.now(),
    });

    if (snaps.length > this.MAX_SNAPSHOTS) {
      snaps.splice(0, snaps.length - this.MAX_SNAPSHOTS);
    }

    // Detect changes from previous snapshot
    if (snaps.length >= 2) {
      const prev = snaps[snaps.length - 2].schema;
      const curr = snaps[snaps.length - 1].schema;
      const detected = this.compareSchemas(connectorId, endpoint, prev, curr);
      for (const change of detected) {
        this.changes.push(change);
      }
      if (this.changes.length > this.MAX_CHANGES) {
        this.changes = this.changes.slice(-this.MAX_CHANGES);
      }
    }

    return hash;
  }

  /**
   * Detect changes between two schemas.
   */
  detectChanges(
    connectorId: string,
    endpoint: string,
    oldSchema: Record<string, unknown>,
    newSchema: Record<string, unknown>
  ): SchemaChange[] {
    return this.compareSchemas(connectorId, endpoint, oldSchema, newSchema);
  }

  /**
   * Compare two schemas and produce a list of changes.
   */
  private compareSchemas(
    connectorId: string,
    endpoint: string,
    oldSchema: Record<string, unknown>,
    newSchema: Record<string, unknown>,
    pathPrefix = ""
  ): SchemaChange[] {
    const changes: SchemaChange[] = [];
    const now = Date.now();

    // Compare properties
    const oldProps = (oldSchema.properties ?? {}) as Record<string, Record<string, unknown>>;
    const newProps = (newSchema.properties ?? {}) as Record<string, Record<string, unknown>>;
    const oldPropNames = new Set(Object.keys(oldProps));
    const newPropNames = new Set(Object.keys(newProps));

    // Fields added
    for (const name of Array.from(newPropNames)) {
      if (!oldPropNames.has(name)) {
        changes.push({
          connectorId,
          endpoint,
          changeType: "field_added",
          path: pathPrefix ? `${pathPrefix}.${name}` : name,
          newValue: newProps[name],
          breaking: false,
          detectedAt: now,
        });
      }
    }

    // Fields removed
    for (const name of Array.from(oldPropNames)) {
      if (!newPropNames.has(name)) {
        changes.push({
          connectorId,
          endpoint,
          changeType: "field_removed",
          path: pathPrefix ? `${pathPrefix}.${name}` : name,
          oldValue: oldProps[name],
          breaking: true,
          detectedAt: now,
        });
      }
    }

    // Type changes
    for (const name of Array.from(oldPropNames)) {
      if (newPropNames.has(name)) {
        const oldType = oldProps[name]?.type;
        const newType = newProps[name]?.type;
        if (oldType !== undefined && newType !== undefined && oldType !== newType) {
          changes.push({
            connectorId,
            endpoint,
            changeType: "type_changed",
            path: pathPrefix ? `${pathPrefix}.${name}` : name,
            oldValue: oldType,
            newValue: newType,
            breaking: true,
            detectedAt: now,
          });
        }

        // Enum changes
        const oldEnum = oldProps[name]?.enum as unknown[] | undefined;
        const newEnum = newProps[name]?.enum as unknown[] | undefined;
        if (oldEnum || newEnum) {
          const oldSet = new Set((oldEnum ?? []).map((e) => JSON.stringify(e)));
          const newSet = new Set((newEnum ?? []).map((e) => JSON.stringify(e)));
          const removed = Array.from(oldSet).filter((e) => !newSet.has(e));
          const added = Array.from(newSet).filter((e) => !oldSet.has(e));
          if (removed.length > 0 || added.length > 0) {
            changes.push({
              connectorId,
              endpoint,
              changeType: "enum_changed",
              path: pathPrefix ? `${pathPrefix}.${name}` : name,
              oldValue: oldEnum,
              newValue: newEnum,
              breaking: removed.length > 0,
              detectedAt: now,
            });
          }
        }

        // Recurse into nested objects
        if (
          oldProps[name]?.type === "object" &&
          newProps[name]?.type === "object"
        ) {
          const nested = this.compareSchemas(
            connectorId,
            endpoint,
            oldProps[name],
            newProps[name],
            pathPrefix ? `${pathPrefix}.${name}` : name
          );
          for (const c of nested) {
            changes.push(c);
          }
        }
      }
    }

    // Required changes
    const oldRequired = new Set((oldSchema.required ?? []) as string[]);
    const newRequired = new Set((newSchema.required ?? []) as string[]);

    for (const field of Array.from(newRequired)) {
      if (!oldRequired.has(field)) {
        changes.push({
          connectorId,
          endpoint,
          changeType: "required_added",
          path: pathPrefix ? `${pathPrefix}.${field}` : field,
          breaking: true,
          detectedAt: now,
        });
      }
    }

    for (const field of Array.from(oldRequired)) {
      if (!newRequired.has(field)) {
        changes.push({
          connectorId,
          endpoint,
          changeType: "required_removed",
          path: pathPrefix ? `${pathPrefix}.${field}` : field,
          breaking: false,
          detectedAt: now,
        });
      }
    }

    return changes;
  }

  /**
   * Get breaking changes only.
   */
  getBreakingChanges(connectorId?: string): SchemaChange[] {
    let filtered = this.changes.filter((c) => c.breaking);
    if (connectorId) {
      filtered = filtered.filter((c) => c.connectorId === connectorId);
    }
    return filtered;
  }

  /**
   * Get all changes.
   */
  getAllChanges(connectorId?: string, limit = 100): SchemaChange[] {
    let filtered = this.changes;
    if (connectorId) {
      filtered = filtered.filter((c) => c.connectorId === connectorId);
    }
    return filtered.slice(-limit);
  }

  /**
   * Get snapshot history for a connector/endpoint.
   */
  getSnapshots(
    connectorId: string,
    endpoint: string
  ): Array<{ hash: string; timestamp: number }> {
    const key = `${connectorId}:${endpoint}`;
    const snaps = this.snapshots.get(key);
    if (!snaps) return [];
    return snaps.map((s) => ({ hash: s.hash, timestamp: s.timestamp }));
  }

  /**
   * Get summary statistics.
   */
  getSummary(): {
    totalSnapshots: number;
    totalChanges: number;
    breakingChanges: number;
    trackedEndpoints: number;
  } {
    let totalSnapshots = 0;
    for (const snaps of Array.from(this.snapshots.values())) {
      totalSnapshots += snaps.length;
    }
    return {
      totalSnapshots,
      totalChanges: this.changes.length,
      breakingChanges: this.changes.filter((c) => c.breaking).length,
      trackedEndpoints: this.snapshots.size,
    };
  }
}

/* ------------------------------------------------------------------ */
/*  ResponseShapeGuard                                                 */
/* ------------------------------------------------------------------ */

export class ResponseShapeGuard {
  private shapes: Map<
    string,
    {
      fields: Map<string, { type: string; frequency: number; totalSeen: number }>;
      sampleCount: number;
    }
  >;
  private reports: ResponseShapeReport[];
  private readonly MAX_REPORTS = 1000;

  constructor() {
    this.shapes = new Map();
    this.reports = [];
  }

  /**
   * Register an expected shape (from schema or manual specification).
   */
  registerShape(
    connectorId: string,
    endpoint: string,
    expectedFields: Record<string, string>
  ): void {
    const key = `${connectorId}:${endpoint}`;
    const fields = new Map<string, { type: string; frequency: number; totalSeen: number }>();

    for (const [name, type] of Object.entries(expectedFields)) {
      fields.set(name, { type, frequency: 1.0, totalSeen: 0 });
    }

    this.shapes.set(key, { fields, sampleCount: 0 });
  }

  /**
   * Learn a shape from actual responses.
   */
  learnShape(connectorId: string, endpoint: string, response: unknown): void {
    if (typeof response !== "object" || response === null || Array.isArray(response)) {
      return;
    }

    const key = `${connectorId}:${endpoint}`;
    let shape = this.shapes.get(key);
    if (!shape) {
      shape = { fields: new Map(), sampleCount: 0 };
      this.shapes.set(key, shape);
    }

    shape.sampleCount++;

    const responseObj = response as Record<string, unknown>;
    const currentFields = new Set(Object.keys(responseObj));

    // Update known fields
    for (const [name, info] of Array.from(shape.fields.entries())) {
      if (currentFields.has(name)) {
        info.totalSeen++;
        info.frequency = info.totalSeen / shape.sampleCount;
        // Update type if needed
        const actualType = this.getType(responseObj[name]);
        if (info.type !== actualType && info.totalSeen === 1) {
          info.type = actualType;
        }
      } else {
        info.frequency = info.totalSeen / shape.sampleCount;
      }
    }

    // Add new fields
    for (const name of Array.from(currentFields)) {
      if (!shape.fields.has(name)) {
        shape.fields.set(name, {
          type: this.getType(responseObj[name]),
          frequency: 1 / shape.sampleCount,
          totalSeen: 1,
        });
      }
    }
  }

  /**
   * Verify a response against the learned/registered shape.
   * Returns a score from 0-100.
   */
  verify(connectorId: string, endpoint: string, response: unknown): ResponseShapeReport {
    const key = `${connectorId}:${endpoint}`;
    const shape = this.shapes.get(key);

    if (!shape || shape.fields.size === 0) {
      const report: ResponseShapeReport = {
        connectorId,
        endpoint,
        shapeScore: 100, // No shape to validate against
        expectedFields: [],
        actualFields: [],
        missingFields: [],
        extraFields: [],
        typeMatches: 0,
        typeMismatches: 0,
        checkedAt: Date.now(),
      };
      this.storeReport(report);
      return report;
    }

    if (typeof response !== "object" || response === null || Array.isArray(response)) {
      const report: ResponseShapeReport = {
        connectorId,
        endpoint,
        shapeScore: 0,
        expectedFields: Array.from(shape.fields.keys()),
        actualFields: [],
        missingFields: Array.from(shape.fields.keys()),
        extraFields: [],
        typeMatches: 0,
        typeMismatches: 0,
        checkedAt: Date.now(),
      };
      this.storeReport(report);
      return report;
    }

    const responseObj = response as Record<string, unknown>;
    const expectedFields = Array.from(shape.fields.keys()).filter(
      (name) => (shape.fields.get(name)?.frequency ?? 0) > 0.5
    );
    const actualFields = Object.keys(responseObj);
    const actualSet = new Set(actualFields);
    const expectedSet = new Set(expectedFields);

    const missingFields = expectedFields.filter((f) => !actualSet.has(f));
    const extraFields = actualFields.filter((f) => !expectedSet.has(f));

    let typeMatches = 0;
    let typeMismatches = 0;

    for (const name of actualFields) {
      const expectedInfo = shape.fields.get(name);
      if (expectedInfo) {
        const actualType = this.getType(responseObj[name]);
        if (actualType === expectedInfo.type) {
          typeMatches++;
        } else {
          typeMismatches++;
        }
      }
    }

    // Calculate score
    const totalExpected = expectedFields.length;
    const presentRatio = totalExpected > 0 ? (totalExpected - missingFields.length) / totalExpected : 1;
    const typeRatio =
      typeMatches + typeMismatches > 0
        ? typeMatches / (typeMatches + typeMismatches)
        : 1;
    const extraPenalty = totalExpected > 0 ? Math.min(extraFields.length / totalExpected, 0.3) : 0;

    const shapeScore = Math.round(
      Math.max(0, Math.min(100, (presentRatio * 0.5 + typeRatio * 0.4 - extraPenalty * 0.1) * 100))
    );

    const report: ResponseShapeReport = {
      connectorId,
      endpoint,
      shapeScore,
      expectedFields,
      actualFields,
      missingFields,
      extraFields,
      typeMatches,
      typeMismatches,
      checkedAt: Date.now(),
    };

    this.storeReport(report);
    return report;
  }

  /**
   * Get the simple type string for a value.
   */
  private getType(value: unknown): string {
    if (value === null) return "null";
    if (Array.isArray(value)) return "array";
    return typeof value;
  }

  /**
   * Store a report with limit enforcement.
   */
  private storeReport(report: ResponseShapeReport): void {
    this.reports.push(report);
    if (this.reports.length > this.MAX_REPORTS) {
      this.reports = this.reports.slice(-this.MAX_REPORTS);
    }
  }

  /**
   * Get recent reports.
   */
  getReports(connectorId?: string, limit = 50): ResponseShapeReport[] {
    let filtered = this.reports;
    if (connectorId) {
      filtered = filtered.filter((r) => r.connectorId === connectorId);
    }
    return filtered.slice(-limit);
  }

  /**
   * Get shape info for an endpoint.
   */
  getShapeInfo(
    connectorId: string,
    endpoint: string
  ): { fields: Record<string, { type: string; frequency: number }>; sampleCount: number } | undefined {
    const key = `${connectorId}:${endpoint}`;
    const shape = this.shapes.get(key);
    if (!shape) return undefined;

    const fields: Record<string, { type: string; frequency: number }> = {};
    for (const [name, info] of Array.from(shape.fields.entries())) {
      fields[name] = { type: info.type, frequency: info.frequency };
    }

    return { fields, sampleCount: shape.sampleCount };
  }

  /**
   * Get average shape score.
   */
  getAverageScore(connectorId?: string): number {
    let filtered = this.reports;
    if (connectorId) {
      filtered = filtered.filter((r) => r.connectorId === connectorId);
    }
    if (filtered.length === 0) return 100;
    return Math.round(filtered.reduce((sum, r) => sum + r.shapeScore, 0) / filtered.length);
  }
}

/* ------------------------------------------------------------------ */
/*  Singletons                                                         */
/* ------------------------------------------------------------------ */

export const schemaValidator = new SchemaValidator();
export const contractTestRunner = new ContractTestRunner(schemaValidator);
export const schemaEvolutionTracker = new SchemaEvolutionTracker();
export const responseShapeGuard = new ResponseShapeGuard();
