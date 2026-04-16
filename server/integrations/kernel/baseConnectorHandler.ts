import type { ConnectorHandlerFactory } from "./connectorRegistry";
import type { ConnectorManifest, ResolvedCredential } from "./types";

export interface RestEndpointConfig {
    path: string;
    method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
}

export interface RestHandlerHooks {
    onBeforeRequest?: (
        req: { url: string; method: string; headers: Record<string, string>; body?: any; query?: URLSearchParams },
        operationId: string,
        input: Record<string, unknown>,
        credential: ResolvedCredential
    ) => Promise<void> | void;
    onAfterResponse?: (
        res: Response,
        data: any,
        operationId: string
    ) => Promise<{ success: boolean; data?: any; error?: any }>;
}

/**
 * Creates a generic REST handler based on a ConnectorManifest.
 * This simplifies development of connector handlers by mapping operationIds
 * to their HTTP methods and endpoint paths automatically, handling the OAuth Bearer token injection.
 */
export const createRestHandler = (
    manifest: ConnectorManifest,
    apiBaseUrl: string,
    endpoints: Record<string, RestEndpointConfig> = {},
    hooks?: RestHandlerHooks
): ConnectorHandlerFactory => {
    return {
        async execute(operationId, input, credential) {
            const cap = manifest.capabilities.find((c) => c.operationId === operationId);

            if (!cap) {
                return {
                    success: false,
                    error: {
                        code: "UNKNOWN_OPERATION",
                        message: `Unknown operation: ${operationId} for connector ${manifest.connectorId}`,
                        retryable: false,
                    },
                };
            }

            // Check explicit endpoints config first
            const endpointDef = endpoints[operationId];
            let endpointPath = endpointDef?.path;

            // Standard HTTP method inference if not explicitly provided
            let method = endpointDef?.method || (
                cap.operationId.includes("create") || cap.operationId.includes("send") || cap.operationId.includes("post")
                    ? "POST"
                    : cap.operationId.includes("update") || cap.operationId.includes("put") || cap.operationId.includes("patch")
                        ? "PATCH" // Default to PATCH for updates in modern APIs, though PUT is also common
                        : cap.operationId.includes("delete") || cap.operationId.includes("remove")
                            ? "DELETE"
                            : "GET"
            );

            // Legacy fallback for Gmail until all are mapped
            if (!endpointPath && manifest.connectorId === "gmail") {
                if (operationId === "gmail_search") endpointPath = "/messages";
                else if (operationId === "gmail_read") endpointPath = "/messages/{messageId}";
                else if (operationId === "gmail_send") endpointPath = "/messages/send";
            }

            if (!endpointPath) {
                return {
                    success: false,
                    error: {
                        code: "UNSUPPORTED_OPERATION",
                        message: `Endpoint path mapping not found for operation: ${operationId}`,
                        retryable: false,
                    },
                };
            }

            let url = endpointPath;
            const queryParams = new URLSearchParams();
            const body: Record<string, any> = {};

            for (const [k, v] of Object.entries(input)) {
                if (url.includes(`{${k}}`)) {
                    url = url.replace(`{${k}}`, String(v));
                } else if (method === "GET") {
                    queryParams.append(k, String(v));
                } else {
                    body[k] = v;
                }
            }

            const reqContext = {
                url: `${apiBaseUrl}${url}`,
                method,
                headers: {
                    Authorization: `Bearer ${credential.accessToken}`,
                    "Content-Type": "application/json",
                } as Record<string, string>,
                query: queryParams,
                body: method !== "GET" && Object.keys(body).length > 0 ? body : undefined,
            };

            if (hooks?.onBeforeRequest) {
                await hooks.onBeforeRequest(reqContext, operationId, input, credential);
            }

            const qStr = reqContext.query.toString();
            const finalUrl = `${reqContext.url}${qStr ? "?" + qStr : ""}`;

            try {
                const res = await fetch(finalUrl, {
                    method: reqContext.method,
                    headers: reqContext.headers,
                    body: reqContext.body ? JSON.stringify(reqContext.body) : undefined,
                });

                const data = await res.json().catch(() => ({}));

                if (hooks?.onAfterResponse) {
                    const hookResult = await hooks.onAfterResponse(res, data, operationId);
                    if (!hookResult.success || hookResult.error) {
                        return {
                            success: false,
                            error: hookResult.error || {
                                code: `HTTP_${res.status}`,
                                message: "Hook validation failed",
                                retryable: false
                            }
                        };
                    }
                    return { success: true, data: hookResult.data ?? data };
                }

                if (!res.ok) {
                    return {
                        success: false,
                        error: {
                            code: `HTTP_${res.status}`,
                            message: data.error?.message || data.message || data.error || res.statusText,
                            retryable: res.status >= 500 || res.status === 429,
                            details: data,
                        },
                    };
                }

                return { success: true, data };
            } catch (err: any) {
                return {
                    success: false,
                    error: {
                        code: "NETWORK_ERROR",
                        message: err.message || "Failed to execute request",
                        retryable: true,
                    }
                };
            }
        },

        async healthCheck(credential) {
            if (!credential) return { healthy: false, latencyMs: 0 };

            const startTime = Date.now();
            try {
                // Quick verification of the token
                const res = await fetch(`${apiBaseUrl}/profile` || apiBaseUrl, {
                    method: "GET",
                    headers: { Authorization: `Bearer ${credential.accessToken}` },
                });
                return { healthy: res.ok || res.status === 403, latencyMs: Date.now() - startTime }; // 403 might just mean wrong scope for profile
            } catch (e) {
                return { healthy: false, latencyMs: Date.now() - startTime };
            }
        }
    };
};
