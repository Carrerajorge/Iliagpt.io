# Execution Protocol

## State Machine

The production workflow runner implements a strict state machine to ensure all runs terminate properly.

### Run States

```
QUEUED → PLANNING → RUNNING → COMPLETED
                  ↘          ↘
                   FAILED ← TIMEOUT
                      ↑
                  CANCELLED
```

| State | Description |
|-------|-------------|
| `queued` | Run created, waiting to start |
| `planning` | Generating execution plan |
| `running` | Executing steps |
| `verifying` | Validating results (optional) |
| `completed` | All steps finished successfully |
| `failed` | Execution error occurred |
| `timeout` | Watchdog timeout triggered |
| `cancelled` | User cancelled the run |

### Guaranteed Termination

Every run MUST terminate in one of: `completed`, `failed`, `timeout`, or `cancelled`.

The system guarantees termination through:
1. **Watchdog Timer**: 30 second timeout (configurable) per step
2. **Finally Block**: Cleanup always runs regardless of errors
3. **Explicit State Transitions**: Every path leads to terminal state

## Run Data Structure

```typescript
interface ProductionRun {
  runId: string;           // UUID
  requestId: string;       // Correlation ID
  status: RunStatus;
  startedAt?: string;      // ISO timestamp
  updatedAt: string;
  completedAt?: string;
  currentStepIndex: number;
  totalSteps: number;
  replansCount: number;
  query: string;
  intent: GenerationIntent;
  plan: RunPlan;
  evidence: RunEvidence[];
  artifacts: ArtifactInfo[];
  error?: string;
  errorType?: "PLANNING_ERROR" | "EXECUTION_ERROR" | "TIMEOUT_ERROR" | "CANCELLED";
}
```

## Event Types

The system emits typed events throughout execution:

| Event Type | When Emitted |
|------------|--------------|
| `run_started` | Run begins execution |
| `step_started` | Step begins execution |
| `tool_called` | Tool invocation started |
| `tool_output` | Tool returned result |
| `step_completed` | Step finished |
| `artifact_created` | File artifact generated |
| `replan_triggered` | Fallback to alternative tool |
| `run_completed` | Run finished successfully |
| `run_failed` | Run failed with error |
| `run_cancelled` | Run cancelled by user |
| `timeout_error` | Watchdog timeout |
| `heartbeat` | Connection keep-alive |

### Event Structure

```typescript
interface RunEvent {
  eventId: string;         // UUID
  runId: string;
  eventType: string;
  timestamp: string;       // ISO timestamp
  stepIndex?: number;
  toolName?: string;
  data?: unknown;
}
```

## Evidence Per Step

Each step records comprehensive evidence:

```typescript
interface RunEvidence {
  stepId: string;
  toolName: string;
  input: unknown;
  output: unknown;
  schemaValidation: "pass" | "fail";
  requestId: string;
  durationMs: number;
  retryCount: number;
  replanEvents: string[];
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  artifacts?: ArtifactInfo[];
  errorStack?: string;
}
```

## Intent Classification

The router classifies user queries into intents:

| Intent | Example Queries | Output |
|--------|-----------------|--------|
| `image_generate` | "crea una imagen de un gato" | PNG image |
| `slides_create` | "genera una presentación" | PPTX file |
| `docx_generate` | "crea un documento word" | DOCX file |
| `xlsx_create` | "genera un excel" | XLSX file |
| `pdf_generate` | "crea un pdf" | PDF file |
| `web_search` | "busca información sobre X" | JSON results |
| `data_analyze` | "analiza estos datos" | Statistics |
| `browse_url` | URL in query | HTML content |

## Plan Validation

For generation intents, the plan validator ensures:
1. At least one generator tool is in the plan
2. Expected artifact type matches intent
3. Fails immediately with `PLANNING_ERROR` if invalid

## Artifact Structure

```typescript
interface ArtifactInfo {
  artifactId: string;      // UUID
  type: string;            // "image", "document", "spreadsheet", etc.
  mimeType: string;        // MIME type
  path: string;            // Absolute file path
  sizeBytes: number;
  createdAt: string;
  previewUrl?: string;     // Optional preview endpoint
}
```

## Watchdog Timer

- Default timeout: 30 seconds
- Resets after each step completion
- On timeout: status → `timeout`, errorType → `TIMEOUT_ERROR`
- Emits `timeout_error` and `run_failed` events

## Error Types

| Error Type | Cause |
|------------|-------|
| `PLANNING_ERROR` | Invalid plan (missing generator tool) |
| `EXECUTION_ERROR` | Tool execution failed |
| `TIMEOUT_ERROR` | Watchdog timeout |
| `CANCELLED` | User cancelled |
