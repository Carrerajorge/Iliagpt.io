import type { ConnectorHandlerFactory } from "../../kernel/connectorRegistry";

const API_BASE = "https://api.hex.com/v1";

export const createHandler = (): ConnectorHandlerFactory => {
  return {
    async execute(operationId, input, credential) {
      switch (operationId) {
        case "hex_search": {
          let url = "/search";
          const queryParams = new URLSearchParams();
          const body: Record<string, any> = {};

          for (const [k, v] of Object.entries(input)) {
            if (url.includes(`{${k}}`)) {
              url = url.replace(`{${k}}`, String(v));
            } else if ("GET" === "GET") {
              queryParams.append(k, String(v));
            } else {
              body[k] = v;
            }
          }

          const qStr = queryParams.toString();
          const finalUrl = `${API_BASE}${url}${qStr ? '?' + qStr : ''}`;
          
          const res = await fetch(finalUrl, {
            method: "GET",
            headers: {
              "Authorization": `Bearer ${credential.accessToken}`,
              "Content-Type": "application/json"
            },
            body: undefined
          });

          const data = await res.json().catch(() => ({}));
          return { success: res.ok, data: res.ok ? data : undefined, error: res.ok ? undefined : data };
        }
        case "hex_create": {
          let url = "/items";
          const queryParams = new URLSearchParams();
          const body: Record<string, any> = {};

          for (const [k, v] of Object.entries(input)) {
            if (url.includes(`{${k}}`)) {
              url = url.replace(`{${k}}`, String(v));
            } else if ("POST" === "GET") {
              queryParams.append(k, String(v));
            } else {
              body[k] = v;
            }
          }

          const qStr = queryParams.toString();
          const finalUrl = `${API_BASE}${url}${qStr ? '?' + qStr : ''}`;
          
          const res = await fetch(finalUrl, {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${credential.accessToken}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify(body)
          });

          const data = await res.json().catch(() => ({}));
          return { success: res.ok, data: res.ok ? data : undefined, error: res.ok ? undefined : data };
        }

        default:
          return {
            success: false,
            error: {
              code: "UNKNOWN_OPERATION",
              message: `Unknown operation: ${operationId}`,
              retryable: false,
            },
          };
      }
    },
  };
};

export const handler = createHandler();
