/**
 * Cognitive Middleware — capability registry (Turn I).
 *
 * A **capability** is a user-facing feature the platform exposes:
 * "generate an Excel workbook", "summarize a PDF", "run a browser
 * automation flow", "schedule a recurring task". Turns A through H
 * built the orchestration BACKBONE (intent, context, tools,
 * validation, persistence, artifacts, sessions). Turn I builds the
 * typed MENU that sits on top of that backbone and says: here are
 * all the things the platform actually does, with a uniform
 * invocation shape and the same never-throws + resilience contract
 * every other layer respects.
 *
 * Why a separate layer from tools (Turn D):
 *
 *   • **Audience.** Tools are MODEL-callable primitives. The LLM
 *     emits a tool_call and the middleware executes it. Capabilities
 *     are ORCHESTRATOR-callable features, invoked by routers,
 *     schedulers, UIs, and agents ABOVE the middleware — the model
 *     doesn't pick them.
 *
 *   • **Granularity.** A single capability ("generate a financial
 *     model in Excel") might internally call many tools (create
 *     workbook, add sheet, write formulas, apply conditional
 *     format). Capabilities can compose tools; tools can't
 *     compose capabilities.
 *
 *   • **Catalog discoverability.** The capability registry exposes
 *     `list()` + `listByCategory()` so dashboards + UIs can render
 *     the full menu of what the platform can do, independent of
 *     whether a specific LLM happens to support function calling.
 *
 *   • **Approval gates.** Some capabilities (delete files, send
 *     email, complete payment) must NOT run without explicit user
 *     consent. The registry's approval gate returns a structured
 *     `approval_required` outcome without invoking the handler;
 *     the UI can surface a confirmation, then re-invoke with
 *     `approvalToken`.
 *
 * Hard guarantees (inherited from the rest of the cognitive layer):
 *
 *   1. **Never throws.** Handler exceptions, unknown capability
 *      ids, timeouts, and abort signals all become structured
 *      `CapabilityInvocation` results with `ok: false` and a
 *      machine-readable `errorCode`.
 *
 *   2. **Timeout isolation.** Every handler runs under a fresh
 *      `AbortController` chained to the caller's signal + a
 *      per-capability timeout (default 60 s). Race-based so
 *      hanging handlers don't pin the orchestrator.
 *
 *   3. **JSON-safe results.** Results are stringified to verify
 *      they can be persisted + transported over HTTP. Cyclic or
 *      non-serializable results return an explicit error code.
 *
 *   4. **Artifact pass-through.** A capability handler can return
 *      `artifacts: CognitiveArtifact[]` in its result, and the
 *      middleware's `invokeCapability` attaches them to the final
 *      `CapabilityInvocation` so UIs can render generated files
 *      directly without re-parsing text.
 */

import type { ProviderToolDescriptor } from "./types";
import type { CognitiveArtifact } from "./artifacts";
import type { CognitiveIntent } from "./types";

// ---------------------------------------------------------------------------
// Category taxonomy (matches the ILIAGPT capability list)
// ---------------------------------------------------------------------------

/**
 * Frozen category taxonomy. New categories can be ADDED; existing
 * ones should never be removed or renamed because dashboards +
 * persisted run records reference them by string.
 */
export type CapabilityCategory =
  | "file_generation"
  | "file_management"
  | "data_analysis"
  | "research_synthesis"
  | "format_conversion"
  | "browser_automation"
  | "computer_use"
  | "scheduled_tasks"
  | "connectors"
  | "plugins"
  | "code_execution"
  | "sub_agents"
  | "projects"
  | "security_governance"
  | "enterprise"
  | "dispatch_mobile"
  | "availability";

/**
 * Human-readable labels for each category. Used by the UI when
 * rendering a capability browser. Frozen so adding a new category
 * here is a compile-time requirement.
 */
export const CAPABILITY_CATEGORY_LABELS: Readonly<
  Record<CapabilityCategory, string>
> = Object.freeze({
  file_generation: "Generación de archivos",
  file_management: "Gestión de archivos locales",
  data_analysis: "Análisis de datos y data science",
  research_synthesis: "Síntesis e investigación",
  format_conversion: "Conversión entre formatos",
  browser_automation: "Automatización de navegador",
  computer_use: "Uso del computador",
  scheduled_tasks: "Tareas programadas y recurrentes",
  connectors: "Conectores e integraciones",
  plugins: "Plugins y personalización",
  code_execution: "Ejecución de código",
  sub_agents: "Sub-agentes y tareas complejas",
  projects: "Proyectos en cowork",
  security_governance: "Seguridad y governance",
  enterprise: "Enterprise / RBAC",
  dispatch_mobile: "Dispatch móvil",
  availability: "Disponibilidad y plataformas",
});

// ---------------------------------------------------------------------------
// Descriptor + handler
// ---------------------------------------------------------------------------

/**
 * One capability's public metadata. UIs render this directly so
 * every field is consumer-facing.
 */
export interface CapabilityDescriptor {
  /**
   * Stable id. Convention: `${category}.${verb}_${target}`,
   * e.g., `file_generation.create_excel_workbook`. Used as the
   * HTTP route parameter and as the key in the registry.
   */
  id: string;
  /** Category — shapes how the UI groups + filters. */
  category: CapabilityCategory;
  /** Short user-facing title. */
  title: string;
  /** One-paragraph description of what this capability does. */
  description: string;
  /**
   * Intents this capability serves. The router + the UI can use
   * this to show "related capabilities" when a user's message
   * classifies into one of these intents.
   */
  intents: ReadonlyArray<CognitiveIntent>;
  /**
   * JSON Schema describing the expected `args` shape. Used for
   * validation on invoke + for generating UI forms.
   */
  inputSchema: Record<string, unknown>;
  /**
   * Whether the capability requires explicit user approval before
   * executing. When true, the first invoke returns an
   * `approval_required` outcome and the caller must re-invoke
   * with a matching `approvalToken`.
   */
  requiresApproval: boolean;
  /**
   * Per-call timeout in ms. Default 60_000. Long-running
   * capabilities (browser automation, large file generation)
   * should override this.
   */
  timeoutMs?: number;
  /**
   * Optional list of tool descriptors the capability CAN use
   * internally. Surfaced so the model's routing logic can see
   * which tools are reachable through which capability.
   */
  supportedTools?: ReadonlyArray<ProviderToolDescriptor>;
  /**
   * Implementation status. "available" means the handler is real
   * and production-ready; "stub" means the handler returns a
   * structured `not_implemented` outcome and is exposed only so
   * UIs can render a "coming soon" entry.
   */
  status: "available" | "stub";
  /**
   * Optional version string so the UI can show "v2 (beta)" style
   * labels. Pure metadata — the registry doesn't dispatch on it.
   */
  version?: string;
}

export interface CapabilityContext {
  /** Stable user id. */
  userId: string;
  /** Optional conversation id from the originating request. */
  conversationId?: string;
  /**
   * Per-call abort signal. Fires on timeout OR when the caller
   * aborts the outer cognitive request.
   */
  signal: AbortSignal;
  /**
   * Approval token. When a capability required approval and the
   * user confirmed, the UI passes the token back on the second
   * invoke. Semantics are per-deployment — the registry only
   * checks that the token is truthy when approval was required.
   */
  approvalToken?: string;
  /**
   * Free-form metadata (request id, trace id, feature flags)
   * that the handler can read but the registry ignores.
   */
  metadata?: Record<string, unknown>;
}

/**
 * The handler function signature. `args` matches the descriptor's
 * `inputSchema`; `result` is anything JSON-serializable. Handlers
 * MAY attach `artifacts` to their result — the middleware's
 * `invokeCapability` hoists them to the top-level invocation so
 * consumers see them uniformly.
 */
export type CapabilityHandler<
  Args extends Record<string, unknown> = Record<string, unknown>,
> = (
  args: Args,
  ctx: CapabilityContext,
) => Promise<CapabilityHandlerResult>;

export interface CapabilityHandlerResult {
  /**
   * The typed result the caller sees. Must be JSON-serializable.
   */
  result: unknown;
  /**
   * Optional artifacts produced by the handler. Merged into the
   * top-level CapabilityInvocation.
   */
  artifacts?: CognitiveArtifact[];
  /**
   * Optional diagnostic message attached to a successful
   * invocation. Renders as a subtitle in the UI.
   */
  message?: string;
}

// ---------------------------------------------------------------------------
// Invocation result
// ---------------------------------------------------------------------------

export type CapabilityErrorCode =
  | "unknown_capability"
  | "invalid_args"
  | "approval_required"
  | "timeout"
  | "aborted"
  | "handler_threw"
  | "not_implemented"
  | "result_not_serializable";

export interface CapabilityInvocation {
  /** The descriptor.id that was invoked. */
  capabilityId: string;
  /** True iff the handler ran + returned successfully. */
  ok: boolean;
  /** The handler's typed result. Present only when ok === true. */
  result?: unknown;
  /** Artifacts the handler produced. Empty when none. */
  artifacts: CognitiveArtifact[];
  /** Optional success message. */
  message?: string;
  /** Human-readable error. Present only on failure. */
  error?: string;
  /** Structured error code. Present only on failure. */
  errorCode?: CapabilityErrorCode;
  /** Wall-clock duration of the handler in ms. */
  durationMs: number;
  /** The category the descriptor belongs to. */
  category: CapabilityCategory;
  /**
   * When the invocation was denied because approval was required,
   * the registry returns a one-time token the UI uses to re-invoke
   * after the user confirms. Null on every other outcome.
   */
  approvalChallengeToken?: string;
}

// ---------------------------------------------------------------------------
// Registry interface
// ---------------------------------------------------------------------------

export interface CapabilityRegistry {
  readonly name: string;
  /** Register a new capability + its handler. */
  register(descriptor: CapabilityDescriptor, handler?: CapabilityHandler): void;
  /** Unregister a capability by id. */
  unregister(id: string): void;
  /** True iff the given id is registered. */
  has(id: string): boolean;
  /** Snapshot of every descriptor. */
  list(): CapabilityDescriptor[];
  /** Descriptors filtered by category. */
  listByCategory(category: CapabilityCategory): CapabilityDescriptor[];
  /** Descriptors advertising a given intent. */
  listByIntent(intent: CognitiveIntent): CapabilityDescriptor[];
  /** Descriptors with `status: "available"` only. */
  listAvailable(): CapabilityDescriptor[];
  /**
   * Invoke a capability. Never throws. On any failure returns a
   * `CapabilityInvocation` with `ok: false` and the appropriate
   * error code.
   */
  invoke(
    id: string,
    args: Record<string, unknown>,
    ctx: CapabilityContext,
  ): Promise<CapabilityInvocation>;
}

// ---------------------------------------------------------------------------
// InMemoryCapabilityRegistry
// ---------------------------------------------------------------------------

export const DEFAULT_CAPABILITY_TIMEOUT_MS = 60_000;

interface RegistryEntry {
  descriptor: CapabilityDescriptor;
  handler: CapabilityHandler | null;
}

/**
 * Built-in stub that every stub capability shares. Returns a
 * not_implemented handler result so the dispatcher can convert
 * it into a structured `CapabilityInvocation` with
 * `errorCode: "not_implemented"`.
 */
const STUB_HANDLER: CapabilityHandler = async () => ({
  result: null,
  message: "capability not yet implemented",
});

export class InMemoryCapabilityRegistry implements CapabilityRegistry {
  readonly name: string;
  private readonly entries = new Map<string, RegistryEntry>();

  constructor(
    initial: ReadonlyArray<{
      descriptor: CapabilityDescriptor;
      handler?: CapabilityHandler;
    }> = [],
    options: { name?: string } = {},
  ) {
    this.name = options.name ?? "in-memory-capabilities";
    for (const entry of initial) {
      this.register(entry.descriptor, entry.handler);
    }
  }

  register(descriptor: CapabilityDescriptor, handler?: CapabilityHandler): void {
    if (!descriptor?.id) {
      throw new Error(
        "InMemoryCapabilityRegistry.register: descriptor.id is required",
      );
    }
    const effectiveHandler =
      handler ?? (descriptor.status === "stub" ? STUB_HANDLER : null);
    if (!effectiveHandler) {
      throw new Error(
        `InMemoryCapabilityRegistry.register: capability "${descriptor.id}" is marked available but has no handler`,
      );
    }
    this.entries.set(descriptor.id, {
      descriptor,
      handler: effectiveHandler,
    });
  }

  unregister(id: string): void {
    this.entries.delete(id);
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  list(): CapabilityDescriptor[] {
    return Array.from(this.entries.values(), (e) => e.descriptor);
  }

  listByCategory(category: CapabilityCategory): CapabilityDescriptor[] {
    return this.list().filter((d) => d.category === category);
  }

  listByIntent(intent: CognitiveIntent): CapabilityDescriptor[] {
    return this.list().filter((d) => d.intents.includes(intent));
  }

  listAvailable(): CapabilityDescriptor[] {
    return this.list().filter((d) => d.status === "available");
  }

  /** Current number of registered capabilities. */
  get size(): number {
    return this.entries.size;
  }

  async invoke(
    id: string,
    args: Record<string, unknown>,
    ctx: CapabilityContext,
  ): Promise<CapabilityInvocation> {
    const start = Date.now();
    const entry = this.entries.get(id);

    if (!entry) {
      return {
        capabilityId: id,
        ok: false,
        artifacts: [],
        errorCode: "unknown_capability",
        error: `capability "${id}" is not registered`,
        durationMs: Date.now() - start,
        category: "availability",
      };
    }

    const descriptor = entry.descriptor;

    // ── 1. Validate args shape ────────────────────────────────────
    if (args === null || typeof args !== "object" || Array.isArray(args)) {
      return failed(descriptor, id, "invalid_args", "args must be a plain object", Date.now() - start);
    }

    // ── 2. Stub handler → not_implemented ─────────────────────────
    if (descriptor.status === "stub") {
      return {
        capabilityId: id,
        ok: false,
        artifacts: [],
        errorCode: "not_implemented",
        error: `capability "${id}" is registered as a stub and has no real implementation yet`,
        durationMs: Date.now() - start,
        category: descriptor.category,
      };
    }

    // ── 3. Approval gate ─────────────────────────────────────────
    if (descriptor.requiresApproval && !ctx.approvalToken) {
      // Mint a one-time challenge token tied to the
      // capability + caller. Not cryptographically signed — a
      // production registry should HMAC this with a server secret.
      const approvalChallengeToken = `challenge_${id}_${ctx.userId}_${Date.now()}`;
      return {
        capabilityId: id,
        ok: false,
        artifacts: [],
        errorCode: "approval_required",
        error: "this capability requires explicit user approval before running",
        durationMs: Date.now() - start,
        category: descriptor.category,
        approvalChallengeToken,
      };
    }

    // ── 4. Pre-abort check ───────────────────────────────────────
    if (ctx.signal.aborted) {
      return failed(descriptor, id, "aborted", "aborted before handler invocation", Date.now() - start);
    }

    // ── 5. Build a per-call controller + timeout ─────────────────
    const innerController = new AbortController();
    const onExternalAbort = (): void => innerController.abort();
    if (ctx.signal.aborted) {
      innerController.abort();
    } else {
      ctx.signal.addEventListener("abort", onExternalAbort, { once: true });
    }
    const timeoutMs = descriptor.timeoutMs ?? DEFAULT_CAPABILITY_TIMEOUT_MS;
    const timer = setTimeout(() => innerController.abort(), timeoutMs);

    const handlerCtx: CapabilityContext = {
      ...ctx,
      signal: innerController.signal,
    };

    // ── 6. Race handler against abort signal ─────────────────────
    let handlerResult: CapabilityHandlerResult | null = null;
    let caughtError: unknown = null;
    try {
      handlerResult = await Promise.race([
        entry.handler!(args, handlerCtx),
        new Promise<never>((_, reject) => {
          if (innerController.signal.aborted) {
            reject(new Error("aborted before race started"));
            return;
          }
          innerController.signal.addEventListener(
            "abort",
            () => reject(new Error("aborted")),
            { once: true },
          );
        }),
      ]);
    } catch (err) {
      caughtError = err;
    } finally {
      clearTimeout(timer);
      ctx.signal.removeEventListener("abort", onExternalAbort);
    }

    const durationMs = Date.now() - start;

    if (caughtError) {
      const aborted = innerController.signal.aborted;
      const timedOut = aborted && !ctx.signal.aborted;
      return failed(
        descriptor,
        id,
        timedOut ? "timeout" : aborted ? "aborted" : "handler_threw",
        caughtError instanceof Error ? caughtError.message : String(caughtError),
        durationMs,
      );
    }

    // ── 7. Verify result JSON-serializes ─────────────────────────
    try {
      JSON.stringify(handlerResult?.result ?? null);
    } catch (err) {
      return failed(
        descriptor,
        id,
        "result_not_serializable",
        `handler returned a non-JSON-serializable result: ${err instanceof Error ? err.message : String(err)}`,
        durationMs,
      );
    }

    return {
      capabilityId: id,
      ok: true,
      result: handlerResult?.result,
      artifacts: handlerResult?.artifacts ?? [],
      message: handlerResult?.message,
      durationMs,
      category: descriptor.category,
    };
  }
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function failed(
  descriptor: CapabilityDescriptor,
  id: string,
  code: CapabilityErrorCode,
  error: string,
  durationMs: number,
): CapabilityInvocation {
  return {
    capabilityId: id,
    ok: false,
    artifacts: [],
    errorCode: code,
    error,
    durationMs,
    category: descriptor.category,
  };
}
