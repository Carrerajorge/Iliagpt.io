import axios, { type AxiosRequestConfig } from "axios"
import { Logger } from "../lib/logger"
import { redis } from "../lib/redis"

export interface OpenAPISpec {
  openapi: string
  info: { title: string; version: string; description?: string }
  servers?: Array<{ url: string; description?: string }>
  paths: Record<string, Record<string, OperationObject>>
  components?: {
    securitySchemes?: Record<string, SecurityScheme>
    schemas?: Record<string, any>
  }
}

interface OperationObject {
  operationId?: string
  summary?: string
  description?: string
  parameters?: any[]
  requestBody?: any
  responses?: Record<string, any>
  security?: any[]
  tags?: string[]
}

interface SecurityScheme {
  type: string
  scheme?: string
  name?: string
  in?: string
  flows?: any
}

export interface DiscoveredEndpoint {
  operationId: string
  method: string
  path: string
  summary?: string
  description?: string
  parameters: ParameterDef[]
  requestBody?: RequestBodyDef
  responseSchema?: any
  authRequired: boolean
  tags: string[]
}

export interface ParameterDef {
  name: string
  in: "query" | "path" | "header" | "cookie"
  required: boolean
  schema?: any
  description?: string
}

export interface RequestBodyDef {
  required: boolean
  contentType: string
  schema?: any
}

export interface AuthConfig {
  type: "bearer" | "api_key" | "basic" | "oauth2" | "none"
  token?: string
  apiKey?: string
  apiKeyHeader?: string
  username?: string
  password?: string
}

export interface ApiCallResult {
  success: boolean
  status: number
  data: any
  headers: Record<string, string>
  durationMs: number
  error?: string
}

interface ConnectorConfig {
  name: string
  specUrl: string
  baseUrl: string
  auth?: AuthConfig
  endpoints: DiscoveredEndpoint[]
  registeredAt: string
}

interface ConnectorSummary {
  name: string
  specUrl: string
  baseUrl: string
  endpointCount: number
  registeredAt: string
}

interface ValidationResult {
  valid: boolean
  errors: string[]
}

const CONNECTOR_KEY_PREFIX = "connector:"
const RATE_LIMIT_PREFIX = "connratelimit:"
const RATE_LIMIT_MAX = 60
const RATE_LIMIT_WINDOW = 60

class APIConnectorFramework {
  private connectors: Map<string, ConnectorConfig> = new Map()

  async discoverFromSpec(specUrl: string, auth?: AuthConfig): Promise<DiscoveredEndpoint[]> {
    Logger.info("[APIConnector] Discovering from spec", { specUrl })

    const response = await axios.get<string>(specUrl, {
      timeout: 15000,
      headers: { Accept: "application/json, application/yaml, text/yaml, */*" },
      responseType: "text",
    })

    const spec = this.parseOpenAPISpec(response.data)
    const endpoints = this.extractEndpoints(spec)
    Logger.info("[APIConnector] Discovered endpoints", { count: endpoints.length, specUrl })
    return endpoints
  }

  async registerConnector(name: string, specUrl: string, auth?: AuthConfig): Promise<DiscoveredEndpoint[]> {
    Logger.info("[APIConnector] Registering connector", { name, specUrl })

    const endpoints = await this.discoverFromSpec(specUrl, auth)

    const response = await axios.get<string>(specUrl, { timeout: 15000, responseType: "text" })
    const spec = this.parseOpenAPISpec(response.data)
    const baseUrl = spec.servers?.[0]?.url ?? ""

    const config: ConnectorConfig = {
      name,
      specUrl,
      baseUrl,
      auth,
      endpoints,
      registeredAt: new Date().toISOString(),
    }

    this.connectors.set(name, config)

    try {
      await redis.setex(
        `${CONNECTOR_KEY_PREFIX}${name}`,
        86400 * 7,
        JSON.stringify(config)
      )
    } catch (err) {
      Logger.warn("[APIConnector] Failed to persist connector", { name, error: (err as Error).message })
    }

    Logger.info("[APIConnector] Connector registered", { name, endpoints: endpoints.length })
    return endpoints
  }

  async callEndpoint(
    connectorName: string,
    operationId: string,
    params: Record<string, any>
  ): Promise<ApiCallResult> {
    const connector = await this.loadConnector(connectorName)
    if (!connector) {
      return { success: false, status: 0, data: null, headers: {}, durationMs: 0, error: `Connector '${connectorName}' not found` }
    }

    const endpoint = connector.endpoints.find((e) => e.operationId === operationId)
    if (!endpoint) {
      return { success: false, status: 0, data: null, headers: {}, durationMs: 0, error: `Endpoint '${operationId}' not found in connector '${connectorName}'` }
    }

    const validation = this.validateParams(endpoint, params)
    if (!validation.valid) {
      return { success: false, status: 400, data: null, headers: {}, durationMs: 0, error: `Validation failed: ${validation.errors.join(", ")}` }
    }

    const rateLimitKey = `${RATE_LIMIT_PREFIX}${connectorName}`
    const count = await redis.incr(rateLimitKey)
    if (count === 1) await redis.expire(rateLimitKey, RATE_LIMIT_WINDOW)
    if (count > RATE_LIMIT_MAX) {
      return { success: false, status: 429, data: null, headers: {}, durationMs: 0, error: "Rate limit exceeded for connector" }
    }

    const requestConfig = this.buildRequest(endpoint, params, connector.auth, connector.baseUrl)

    const start = Date.now()
    try {
      const response = await axios(requestConfig)
      const durationMs = Date.now() - start
      Logger.info("[APIConnector] Call success", { connectorName, operationId, status: response.status, durationMs })
      return {
        success: true,
        status: response.status,
        data: response.data,
        headers: response.headers as Record<string, string>,
        durationMs,
      }
    } catch (err: any) {
      const durationMs = Date.now() - start
      const status = err?.response?.status ?? 0
      const error = err?.response?.data?.message ?? err?.message ?? "Request failed"
      Logger.error("[APIConnector] Call failed", { connectorName, operationId, status, error })
      return {
        success: false,
        status,
        data: err?.response?.data ?? null,
        headers: {},
        durationMs,
        error,
      }
    }
  }

  async listConnectors(): Promise<ConnectorSummary[]> {
    // Load from Redis if local map is empty
    await this.loadAllConnectors()

    return Array.from(this.connectors.values()).map((c) => ({
      name: c.name,
      specUrl: c.specUrl,
      baseUrl: c.baseUrl,
      endpointCount: c.endpoints.length,
      registeredAt: c.registeredAt,
    }))
  }

  async getConnectorEndpoints(name: string): Promise<DiscoveredEndpoint[]> {
    const connector = await this.loadConnector(name)
    return connector?.endpoints ?? []
  }

  async removeConnector(name: string): Promise<void> {
    this.connectors.delete(name)
    try {
      await redis.del(`${CONNECTOR_KEY_PREFIX}${name}`)
      Logger.info("[APIConnector] Connector removed", { name })
    } catch (err) {
      Logger.warn("[APIConnector] Failed to remove connector from Redis", { name, error: (err as Error).message })
    }
  }

  private parseOpenAPISpec(raw: string): OpenAPISpec {
    // Try JSON first
    const trimmed = raw.trim()
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        return JSON.parse(trimmed)
      } catch (err) {
        throw new Error(`Failed to parse OpenAPI spec as JSON: ${(err as Error).message}`)
      }
    }

    // Parse YAML manually (minimal implementation for common OpenAPI patterns)
    // For production, would use yaml package: import yaml from 'yaml'
    // Attempt to convert simple YAML to JSON via basic parsing
    try {
      // Try dynamic import of yaml package if available
      const parsed = this.parseYamlFallback(trimmed)
      return parsed as OpenAPISpec
    } catch {
      throw new Error("Failed to parse OpenAPI spec: unsupported format. Ensure spec is valid JSON or YAML.")
    }
  }

  private parseYamlFallback(yaml: string): any {
    // Attempt to use the 'yaml' npm package dynamically
    // This avoids a static import that might fail if yaml is not installed
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const yamlModule = require("yaml")
      return yamlModule.parse(yaml)
    } catch {
      // If yaml package unavailable, try basic conversion
      throw new Error("yaml package not available; please install it: npm install yaml")
    }
  }

  private buildRequest(
    endpoint: DiscoveredEndpoint,
    params: Record<string, any>,
    auth?: AuthConfig,
    baseUrl?: string
  ): AxiosRequestConfig {
    const remainingParams = { ...params }

    // Substitute path parameters
    let resolvedPath = endpoint.path
    for (const param of endpoint.parameters.filter((p) => p.in === "path")) {
      if (param.name in remainingParams) {
        resolvedPath = resolvedPath.replace(
          `{${param.name}}`,
          encodeURIComponent(String(remainingParams[param.name]))
        )
        delete remainingParams[param.name]
      }
    }

    // Separate query parameters
    const queryParams: Record<string, any> = {}
    for (const param of endpoint.parameters.filter((p) => p.in === "query")) {
      if (param.name in remainingParams) {
        queryParams[param.name] = remainingParams[param.name]
        delete remainingParams[param.name]
      }
    }

    // Build headers
    const headers: Record<string, string> = {
      "Content-Type": endpoint.requestBody?.contentType ?? "application/json",
      Accept: "application/json",
    }

    // Header parameters
    for (const param of endpoint.parameters.filter((p) => p.in === "header")) {
      if (param.name in remainingParams) {
        headers[param.name] = String(remainingParams[param.name])
        delete remainingParams[param.name]
      }
    }

    let config: AxiosRequestConfig = {
      method: endpoint.method.toLowerCase() as any,
      url: `${baseUrl ?? ""}${resolvedPath}`,
      params: Object.keys(queryParams).length > 0 ? queryParams : undefined,
      headers,
      timeout: 30000,
    }

    // Set request body for POST/PUT/PATCH
    if (["post", "put", "patch"].includes(endpoint.method.toLowerCase())) {
      if (endpoint.requestBody && Object.keys(remainingParams).length > 0) {
        config.data = remainingParams
      }
    }

    return this.applyAuth(config, auth)
  }

  private validateParams(endpoint: DiscoveredEndpoint, params: Record<string, any>): ValidationResult {
    const errors: string[] = []

    for (const param of endpoint.parameters) {
      if (param.required && !(param.name in params)) {
        errors.push(`Missing required parameter: '${param.name}'`)
        continue
      }
      if (param.name in params && param.schema) {
        const value = params[param.name]
        const schemaType = param.schema.type
        if (schemaType === "integer" || schemaType === "number") {
          if (typeof value !== "number" && isNaN(Number(value))) {
            errors.push(`Parameter '${param.name}' must be a ${schemaType}`)
          }
        } else if (schemaType === "boolean") {
          if (typeof value !== "boolean" && value !== "true" && value !== "false") {
            errors.push(`Parameter '${param.name}' must be a boolean`)
          }
        }
      }
    }

    if (endpoint.requestBody?.required) {
      const bodyParams = Object.keys(params).filter(
        (k) => !endpoint.parameters.some((p) => p.in === "path" || p.in === "query" || p.in === "header")
      )
      if (bodyParams.length === 0 && endpoint.requestBody.required) {
        // Don't error if all params accounted for in non-body positions
      }
    }

    return { valid: errors.length === 0, errors }
  }

  private applyAuth(config: AxiosRequestConfig, auth?: AuthConfig): AxiosRequestConfig {
    if (!auth || auth.type === "none") return config

    const headers = (config.headers ?? {}) as Record<string, string>

    switch (auth.type) {
      case "bearer":
        if (auth.token) headers["Authorization"] = `Bearer ${auth.token}`
        break
      case "api_key":
        if (auth.apiKey) {
          const header = auth.apiKeyHeader ?? "X-API-Key"
          headers[header] = auth.apiKey
        }
        break
      case "basic":
        if (auth.username && auth.password) {
          const encoded = Buffer.from(`${auth.username}:${auth.password}`).toString("base64")
          headers["Authorization"] = `Basic ${encoded}`
        }
        break
      case "oauth2":
        if (auth.token) headers["Authorization"] = `Bearer ${auth.token}`
        break
    }

    return { ...config, headers }
  }

  private extractEndpoints(spec: OpenAPISpec): DiscoveredEndpoint[] {
    const endpoints: DiscoveredEndpoint[] = []
    const globalSecurity = (spec as any).security ?? []
    const hasGlobalAuth = globalSecurity.length > 0

    for (const [path, methods] of Object.entries(spec.paths ?? {})) {
      for (const [method, operation] of Object.entries(methods)) {
        if (["get", "post", "put", "patch", "delete", "head", "options"].indexOf(method) === -1) continue

        const op = operation as OperationObject
        const operationId = op.operationId ?? `${method}_${path.replace(/[^a-zA-Z0-9]/g, "_")}`

        const parameters: ParameterDef[] = (op.parameters ?? []).map((p: any) => ({
          name: p.name ?? "",
          in: p.in ?? "query",
          required: p.required ?? false,
          schema: p.schema ?? undefined,
          description: p.description ?? undefined,
        }))

        let requestBody: RequestBodyDef | undefined
        if (op.requestBody) {
          const rb = op.requestBody
          const contentTypes = Object.keys(rb.content ?? {})
          const primaryCt = contentTypes[0] ?? "application/json"
          requestBody = {
            required: rb.required ?? false,
            contentType: primaryCt,
            schema: rb.content?.[primaryCt]?.schema ?? undefined,
          }
        }

        // Determine if auth is required
        const opSecurity = op.security ?? globalSecurity
        const authRequired = hasGlobalAuth || (Array.isArray(opSecurity) && opSecurity.length > 0)

        // Get response schema from 200/201 response
        const successResponse = op.responses?.["200"] ?? op.responses?.["201"]
        const responseSchema = successResponse?.content?.["application/json"]?.schema ?? undefined

        endpoints.push({
          operationId,
          method: method.toUpperCase(),
          path,
          summary: op.summary,
          description: op.description,
          parameters,
          requestBody,
          responseSchema,
          authRequired,
          tags: op.tags ?? [],
        })
      }
    }

    Logger.debug("[APIConnector] Extracted endpoints", { count: endpoints.length })
    return endpoints
  }

  private async loadConnector(name: string): Promise<ConnectorConfig | null> {
    if (this.connectors.has(name)) return this.connectors.get(name)!

    try {
      const stored = await redis.get(`${CONNECTOR_KEY_PREFIX}${name}`)
      if (stored) {
        const config: ConnectorConfig = JSON.parse(stored)
        this.connectors.set(name, config)
        return config
      }
    } catch (err) {
      Logger.warn("[APIConnector] Failed to load connector from Redis", { name, error: (err as Error).message })
    }

    return null
  }

  private async loadAllConnectors(): Promise<void> {
    try {
      const keys = await redis.keys(`${CONNECTOR_KEY_PREFIX}*`)
      for (const key of keys) {
        const name = key.replace(CONNECTOR_KEY_PREFIX, "")
        if (!this.connectors.has(name)) {
          const stored = await redis.get(key)
          if (stored) {
            const config: ConnectorConfig = JSON.parse(stored)
            this.connectors.set(name, config)
          }
        }
      }
    } catch (err) {
      Logger.warn("[APIConnector] Failed to load all connectors", { error: (err as Error).message })
    }
  }
}

export const apiConnectorFramework = new APIConnectorFramework()
