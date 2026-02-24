import type { ConnectorHandlerFactory } from "../../kernel/connectorRegistry";

export const createHandler = (): ConnectorHandlerFactory => {
  return {
    async execute(operationId, input, credential) {
      if (operationId === "apple_music_get_status") {
        return {
          success: true,
          data: { status: "ok", message: "Apple Music is connected" },
        };
      }
      return {
        success: false,
        error: {
          code: "UNKNOWN_OPERATION",
          message: `Unknown operation: ${operationId}`,
          retryable: false,
        },
      };
    },
  };
};

export const handler = createHandler();
