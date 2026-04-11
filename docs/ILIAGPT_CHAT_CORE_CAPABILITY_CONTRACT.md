# Iliagpt Chat Core Capability Contract

Date: 2026-04-11
Status: Working contract
Scope: Define the capabilities that must be exposed through the main chat as a single coherent runtime, independent of the underlying LLM provider.

## Objective

Iliagpt chat must stop behaving like a thin prompt box with attached features and instead operate as the functional and cognitive control plane of the product. Every capability that matters to the user must be reachable from the same chat surface through one stable contract:

1. understand the request
2. classify intent deterministically
3. select the right capability or execution mode
4. execute with visible state
5. validate outputs
6. persist context, runs, artifacts, and metrics
7. return a coherent final response without hidden failures

This contract applies regardless of whether the selected model is OpenAI, Anthropic, Google, OpenRouter, local, or any future provider.

## Architectural principle

The chat is the product kernel. LLMs are replaceable reasoning providers. Tools, connectors, document engines, browser automation, memory, workspaces, and schedulers are first-class runtime capabilities coordinated by the chat kernel.

The required backbone is:

```text
User Message
  -> Inbound normalization
  -> Cognitive kernel
  -> Capability registry + policy + quota
  -> Execution planner
  -> Tool / agent / document / browser / connector runtime
  -> Validation + normalization
  -> Streaming state + previews + downloads
  -> Persistence + memory + telemetry
  -> Final assistant response
```

## Core runtime contract

Every chat request must pass through the same logical stages:

1. `normalize`
   Inputs, attachments, workspace, channel, user identity, and model preference are normalized into one request envelope.
2. `understand`
   The cognitive layer produces:
   - shared intent
   - authoritative intent
   - workflow type
   - provider recommendation
   - memory/context enrichment
3. `authorize`
   Policy, quota, connector permissions, workspace rules, and destructive-action protections are checked before execution.
4. `execute`
   The request is routed to one of:
   - conversation
   - artifact generation
   - skill dispatch
   - agent execution
   - browser/computer use
   - connector operation
   - scheduled task runtime
5. `validate`
   Outputs are verified against their contract:
   - file format validity
   - schema validity
   - preview availability
   - provider/tool consistency
   - terminal state coherence
6. `render`
   The frontend renders one coherent state machine:
   - running
   - verifying
   - completed
   - failed
   - timeout
   - cancelled
7. `persist`
   Runs, artifacts, state, memory, logs, token usage, cost, metrics, and evidence are stored.
8. `close`
   The user receives one final response consistent with the execution outcome. No hidden zombie state is allowed.

## Chat-visible UX contract

Any capability surfaced through chat must obey the same user-visible behavior:

- The chat shows what workflow was selected.
- The chat shows step progress and current status.
- Streaming and final state must not contradict each other.
- A run that produced valid artifacts cannot later degrade into a visible false failure.
- A run that failed cannot show success affordances unless a valid recovered artifact exists.
- Buttons such as `View`, `Preview`, `Download`, `Retry`, and `Open in Workspace` must be functional, not decorative.
- Long-running actions must expose heartbeats or progress events.
- Every run must end in a terminal state.

## Capability domains that must exist in chat

### 1. Document and artifact generation

The main chat must expose professional generation and editing for:

- Excel `.xlsx`
- PowerPoint `.pptx`
- Word `.docx`
- PDF
- Markdown `.md`
- HTML `.html`
- React `.jsx` / `.tsx`
- LaTeX
- CSV / TSV
- JSON
- PNG charts
- source-code files

Required behaviors:

- natural-language routing from chat
- structured run creation
- pipeline execution with typed steps
- preview and split-view when relevant
- binary download with filename and `Content-Disposition`
- artifact persistence and retrieval

### 2. Local file management

The main chat must be able to operate on authorized local folders with:

- read and write access
- semantic organization by content, not only filename
- batch rename
- deduplication
- folder creation
- decision logs
- explicit approval before destructive operations

### 3. Data analysis and data science

The main chat must support:

- statistics
- outlier detection
- crosstabs
- time-series analysis
- forecasting
- ML model training on user data
- data cleaning
- data visualization
- PDF table extraction into structured outputs

### 4. Synthesis and research

The main chat must support:

- multi-document synthesis
- contradiction detection
- source citation
- executive summaries
- web research
- connector-based research across user systems

### 5. Format conversion

The main chat must support conversions such as:

- PDF to PowerPoint
- notes to document
- CSV to Excel model
- Word to slides
- screenshot receipts to spreadsheet
- Excel to Word report

### 6. Browser automation

The main chat must be able to:

- navigate sites
- click and fill forms
- capture screenshots
- extract content
- run page-context JavaScript
- perform web research directly

### 7. Computer use

The main chat must be able to:

- open desktop apps
- interact with browser and office apps
- fill spreadsheets or forms directly
- ask permission before accessing a new app

### 8. Scheduled and recurring tasks

The main chat must support:

- daily / weekly / custom cadences
- on-demand saved tasks
- remembered execution configs
- auditable run history

### 9. Dispatch and multi-device continuation

The main chat must support:

- task dispatch from mobile
- execution on desktop runtime
- persistent conversation thread across devices

### 10. Connectors and MCP integrations

The main chat must present connectors as first-class capabilities, including at minimum:

- Google Drive
- Gmail
- Slack
- Notion
- GitHub
- Linear
- Jira
- Asana
- CRMs
- Zoom
- DocuSign
- marketplace plugins

### 11. Plugins and customization

The main chat must support:

- public/private plugin marketplaces
- domain-specific plugins
- built-in skills for xlsx, pptx, docx, pdf
- custom skill creation
- global and folder-level instructions
- per-project context

### 12. Sandboxed code execution

The main chat must support:

- Python and Node execution
- common data libraries
- isolated execution environments
- safe automation scripts

### 13. Sub-agents and parallel tasking

The main chat must support:

- decomposition of complex tasks
- sub-agent orchestration
- internal todo tracking
- bounded long-running work

### 14. Persistent project workspaces

The main chat must support:

- project-scoped memory
- project-scoped files and links
- project-scoped instructions
- persistent threads

### 15. Security and governance

The main chat must enforce:

- folder allowlists
- isolated code execution
- configurable network access
- approval gates for significant actions
- delete protection
- local or governed history retention

### 16. Enterprise controls

The main chat must support:

- RBAC
- spend limits
- analytics
- OpenTelemetry
- connector-level enable/disable
- private plugin marketplaces
- team-level toggles

### 17. Domain packs

The main chat must package high-value workflows for:

- legal
- finance
- marketing
- operations
- HR
- research

### 18. Platform availability constraints

The chat contract must remain coherent across:

- macOS
- Windows
- desktop
- web
- mobile dispatch surfaces

## Capability orchestration model

To make the previous list production-grade, the chat must use six central registries.

### A. Intent registry

Maps natural language requests to normalized intents and output contracts.

Examples:

- `create_word_report` -> `artifact_generation`
- `fill_pdf_form` -> `artifact_generation`
- `analyze_sales_csv` -> `agent_execution`
- `browse_competitor_site` -> `browser_automation`
- `summarize_drive_folder` -> `connector_research`

### B. Capability registry

Maps normalized intents to concrete runtimes:

- Office/Artifact engine
- skill runtime
- browser runtime
- computer-use runtime
- connector runtime
- scheduler runtime
- code sandbox

### C. Policy registry

Applies:

- permissions
- quota
- allowed connectors
- workspace boundaries
- destructive action controls
- enterprise toggles

### D. Provider registry

Selects the best LLM adapter based on:

- required capability
- latency / cost / quality strategy
- vision, reasoning, function calling, or long-context needs
- enterprise policy

### E. Rendering registry

Controls how results appear in chat:

- plain response
- steps timeline
- split preview
- artifact card
- chart/table viewer
- connector summary card
- browser/computer-use feed

### F. Persistence registry

Stores and retrieves:

- runs
- artifacts
- previews
- logs
- metrics
- message metadata
- workspace memory
- schedules

## Production contracts by runtime

### Conversation runtime

For pure conversational requests:

- must still pass through cognitive kernel
- may use memory and provider routing
- must not accidentally trigger agent/document flows unless intent promotion is justified

### Artifact runtime

For document/file requests:

- must create a run
- must stream typed steps
- must validate the artifact before surfacing `ready`
- must expose preview/download actions
- must persist artifacts and preview metadata

### Agent runtime

For multi-step tool use:

- must expose plan and step execution
- must show tool evidence
- must terminate cleanly

### Connector runtime

For SaaS operations:

- must expose connector identity and target resource
- must respect enterprise policy
- must show external side effects clearly

### Browser and computer-use runtime

For action-on-screen requests:

- must surface permission gates
- must stream visible actions
- must preserve auditability

### Scheduler runtime

For recurring tasks:

- must persist cadence and execution params
- must expose last run / next run / failures

## Current repository alignment

The current repo already contains important parts of this architecture:

- hybrid routing and escalation contract in [`docs/ROUTER.md`](/Users/luis/Iliagpt.io/docs/ROUTER.md)
- run state machine contract in [`docs/execution-protocol.md`](/Users/luis/Iliagpt.io/docs/execution-protocol.md)
- document-business E2E evidence in [`docs/OFFICE_ENGINE_BUSINESS_BATTERY_REPORT_2026-04-11.md`](/Users/luis/Iliagpt.io/docs/OFFICE_ENGINE_BUSINESS_BATTERY_REPORT_2026-04-11.md)
- OpenClaw runtime and capability gateway evidence in [`docs/OPENCLAW_V2026.4.10_INTEGRATION_REPORT_2026-04-11.md`](/Users/luis/Iliagpt.io/docs/OPENCLAW_V2026.4.10_INTEGRATION_REPORT_2026-04-11.md)
- agentic system integration entrypoint in [`server/integration/index.ts`](/Users/luis/Iliagpt.io/server/integration/index.ts)
- runtime tool wiring in [`server/integration/toolWiring.ts`](/Users/luis/Iliagpt.io/server/integration/toolWiring.ts)
- multi-provider AI registry in [`server/lib/ai/providers`](/Users/luis/Iliagpt.io/server/lib/ai/providers)
- cognitive preflight kernel in [`server/cognitive/chatKernel.ts`](/Users/luis/Iliagpt.io/server/cognitive/chatKernel.ts)
- project workspace UI in [`client/src/pages/project-workspace.tsx`](/Users/luis/Iliagpt.io/client/src/pages/project-workspace.tsx)

## Capability status matrix

Status legend:

- `Integrated`: already connected to the main product runtime in a meaningful way
- `Partial`: substantial pieces exist but are not yet uniformly exposed through the main chat
- `Gap`: required by contract but not yet centrally integrated

| Domain | Status | Notes |
|---|---|---|
| Multi-LLM provider routing | Integrated | provider registry and model capability metadata already exist |
| Cognitive intent + context preflight | Integrated | central kernel exists and is wired into main chat flow |
| Office/document generation in chat | Integrated | strong DOCX/XLSX/PPTX/PDF path already validated |
| Artifact preview/download contract | Integrated | preview, split-view, and download flows already exist for office artifacts |
| General tool wiring | Partial | wired in agentic layer, but not every tool is yet a uniform chat-first contract |
| Local file management | Partial | filesystem wiring exists, but product-grade chat UX and policy layer still need hardening |
| Data science workflows | Partial | code execution and spreadsheets exist; packaged analysis journeys still need standardization |
| Research and synthesis | Partial | web search and memory exist; connector-wide synthesis needs a stricter common contract |
| Format conversion | Partial | many conversions are technically reachable but not yet standardized as chat capabilities |
| Browser automation | Partial | available through skills/tooling, not yet fully normalized as a default core runtime |
| Computer use | Gap | explicit app-permissioned desktop control is not yet a uniform main-chat runtime |
| Scheduled tasks | Partial | background task infrastructure exists, but chat scheduling UX is not yet complete |
| Dispatch/mobile continuation | Gap | requires explicit desktop-mobile runtime bridge contract |
| Connectors as first-class chat capabilities | Partial | many connectors exist, but selection/rendering is not yet fully uniform in the main chat |
| Plugin marketplace and customization | Partial | skill/plugin surfaces exist; central chat governance and discovery still need consolidation |
| Sub-agents | Partial | runtime support exists, but not every complex flow is yet orchestrated through one chat contract |
| Persistent project workspaces | Partial | workspace surfaces exist, but main chat and workspace runtime still need fuller convergence |
| Security/governance | Partial | many controls exist; enforcement must be centralized per capability |
| Enterprise observability and controls | Partial | quota, analytics, and gateway controls exist; full OTel-grade capability tracing remains incomplete |

## Non-negotiable invariants

The chat must satisfy these invariants in production:

1. One user message creates one coherent execution narrative.
2. State transitions are monotonic and auditable.
3. Terminal states are final and visible.
4. Tool errors cannot remain silent.
5. Preview/download affordances only appear when backed by real resources.
6. Provider changes must not alter chat semantics.
7. Capability routing must be deterministic for explicit requests.
8. The system must degrade safely when a provider, connector, or runtime is unavailable.

## Priority implementation order

### Priority 1: Core control plane

- unify chat request envelope
- centralize intent registry
- centralize capability registry
- centralize policy/quota gates
- centralize rendering state machine

### Priority 2: Capability normalization

- standardize document flows
- standardize connector flows
- standardize browser/computer-use flows
- standardize conversion flows
- standardize scheduled-task flows

### Priority 3: Workspace and memory coherence

- bind chat, projects, files, runs, and memory into one project model
- expose reusable context and run history inside the chat

### Priority 4: Enterprise hardening

- capability-level telemetry
- audit logs
- RBAC and team toggles
- quota and spend guardrails
- connector governance

## Required test strategy

No capability counts as complete until it passes all applicable layers:

1. unit tests
2. integration tests
3. streaming contract tests
4. artifact validation tests
5. concurrency and retry tests
6. UX state tests
7. quota/policy tests
8. end-to-end chat tests

Minimum evidence expected for any production capability:

- natural-language trigger from chat
- correct routing
- visible run or action state
- validated result
- persistence proof
- retry/failure handling
- no silent degradation

## Immediate product interpretation

Your capability list should be treated as the target contract for the main chat, not as a menu of optional add-ons. From now on, new work should be evaluated against one question:

Does this capability behave as a first-class, observable, provider-agnostic chat runtime?

If the answer is no, the feature is still incomplete.
