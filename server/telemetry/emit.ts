import { createEvent, type QueueEvent, type CorrelationIds } from "./index";
import { emitDashboardEvent } from "./emitter";

type QueueEventInput = Omit<QueueEvent, "eventId" | "idempotencyKey" | "timestamp" | "schemaVersion" | "correlationIds">;

function createCorrelationContext(
  queueName: string,
  action: QueueEvent["action"],
): CorrelationIds {
  return {
    traceId: `queue:${queueName}:${action}`,
    requestId: "queue-emitter",
  };
}

export function emitQueueEvent(input: QueueEventInput): boolean {
  const payload: Omit<QueueEvent, "eventId" | "idempotencyKey" | "timestamp" | "schemaVersion"> = {
    ...input,
    correlationIds: createCorrelationContext(input.queueName, input.action),
    category: "queue_event",
  };

  const event = createEvent(payload);
  try {
    return emitDashboardEvent(event);
  } catch {
    return false;
  }
}
