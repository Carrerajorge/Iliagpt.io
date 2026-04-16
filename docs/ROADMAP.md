# IliaGPT Product Roadmap

This document describes what the IliaGPT team is working on, what is planned, and where the project is headed over the next 18+ months. Items in earlier quarters are more concrete; items further out are more speculative and subject to change based on community feedback and business priorities.

> **Last updated:** April 2026
> **Current stable version:** 1.1.0
> **Feedback:** Open a [Feature Request](https://github.com/iliagpt/iliagpt/issues/new?template=feature_request.md) to influence what gets built next.

---

## Current Status — v1.1.0 (April 2026)

IliaGPT 1.1.0 ships as a production-ready, full-stack AI platform across three deployment targets: web app, Electron desktop, and Chrome browser extension. The following 18 capability categories are available today:

| # | Capability | Status |
|---|---|---|
| 1 | **Chat & Conversation** | Available — streaming, context management, multi-chat workspace |
| 2 | **Document Generation** | Available — Word (.docx), PDF, structured reports |
| 3 | **Spreadsheet & Data** | Available — Excel generation, Python analysis sandbox, pivot tables |
| 4 | **Presentation** | Available — PPTX generation from structured outlines |
| 5 | **Code Generation & Execution** | Available — multi-language sandbox, 30s/512MB limits |
| 6 | **Browser Automation** | Available — OpenClaw v2026.4.5 with WebSocket gateway |
| 7 | **Web Search & Research** | Available — internet access pipeline, deep-research agent |
| 8 | **File & Document Processing** | Available — PDF, DOCX, CSV, images; OCR via vision models |
| 9 | **Long-Term Memory** | Available — LLM-extracted facts, pgvector recall, importance scoring |
| 10 | **Multi-Agent Orchestration** | Available — LangGraph DAG, specialized sub-agents, Plan Mode |
| 11 | **Integrations & MCP Connectors** | Available — Slack, Notion, Linear, GitHub, Jira, Telegram |
| 12 | **Scheduled Tasks & Triggers** | Available — cron expressions, webhook triggers, manual runs |
| 13 | **Image Understanding** | Available — GPT-4o / Claude vision, uploaded and URL images |
| 14 | **Audio / Voice** | Stub — transcription via Whisper planned for v1.2.0 |
| 15 | **Authentication & Security** | Available — Google/Microsoft/Auth0 OAuth, RBAC, CSRF, rate limiting |
| 16 | **Deployment & Infrastructure** | Available — Docker, Drizzle migrations, horizontal scaling via Redis pub/sub |
| 17 | **Developer API** | Available — OpenAI-compatible `/v1/*` endpoints, API key management |
| 18 | **UI / UX** | Available — artifacts panel, hybrid search modal, presence indicators |

---

## Q2 2026 — v1.2.0 (Target: June 2026)

### Voice Input / Output
Integrate OpenAI Whisper for speech-to-text and a configurable TTS backend (OpenAI, ElevenLabs, local Coqui TTS). Users will be able to speak prompts in the web UI and desktop app and receive spoken responses. This promotes IliaGPT from a stub to a fully available Audio/Voice capability.

### Real-Time Collaboration
Allow multiple authenticated users to share a single workspace. Shared chats will show live cursors, typing indicators, and attributed messages. Built on top of the existing WebSocket presence system. Includes conflict resolution for concurrent edits to shared agent configurations.

### Advanced RAG with Graph-Based Retrieval
Replace the current flat pgvector similarity search with a hybrid knowledge graph approach. Documents will be parsed into entity–relationship triplets stored in a graph layer, enabling multi-hop reasoning queries (e.g., "find all issues linked to the service that uses this library"). Baseline pgvector retrieval remains as a fallback.

### Expanded MCP Connector Library (20+ Connectors)
Grow the Model Context Protocol connector catalog from the current 6 (Slack, Notion, Linear, GitHub, Jira, Telegram) to 20+. Target additions: Google Drive, Confluence, Salesforce, HubSpot, Zendesk, Airtable, Trello, Asana, Monday.com, Stripe, PagerDuty, Datadog, and a generic REST connector builder.

### Mobile App (React Native)
Ship iOS and Android apps built on React Native sharing business logic with the web client. Core features: chat, file attachment, voice input, push notifications for scheduled task completions and agent replies. Authentication via existing OAuth providers.

### Workflow Builder (Visual DAG Editor)
A drag-and-drop interface for composing multi-agent workflows without writing code. Users will connect agent nodes, tool nodes, conditional branches, and loops on a canvas. Workflows compile to LangGraph definitions and are stored in the database as versioned JSON. Includes a template gallery with common workflow patterns (research → summarize → email, code review, data pipeline).

### Streaming Artifact Diffs
When an agent updates an existing document artifact (e.g., editing a report), show an inline diff view rather than replacing the artifact entirely. Users can accept or reject individual hunks, similar to a code review interface.

### Improved Smart Router — Cost Optimization Mode
Add an explicit cost-optimization mode to the smart router that biases model selection aggressively toward cheaper models (DeepSeek, Groq, Cerebras) unless the task explicitly requires frontier model capabilities. Controlled via a per-user and per-workspace setting with a "performance vs. cost" slider in the UI.

### Plugin SDK and Documentation
Publish a stable Plugin SDK (`@iliagpt/plugin-sdk`) on npm with TypeScript types, a scaffolding CLI (`npx create-iliagpt-plugin`), and comprehensive documentation. The SDK wraps the internal tool and connector registration APIs behind a stable versioned surface, making it safe for third-party developers to build against without worrying about internal refactors.

---

## Q3 2026 — v1.3.0 (Target: September 2026)

### Fine-Tuned Domain Models
Partner with fine-tuning providers to offer domain-specialized model checkpoints for legal contract analysis, financial report parsing, and medical documentation summarization. These models will be selectable via the smart router's capability profile and surfaced in the model selector UI. Fine-tuned models will be hosted on Fireworks AI and Together AI with fallback to base models.

### Custom Embedding Models
Allow enterprise users to configure a custom embedding model endpoint in place of the default OpenAI `text-embedding-3-small`. Support will cover any OpenAI-compatible `/v1/embeddings` API, enabling on-premises embedding with locally hosted models (Ollama, LM Studio) for organizations with data residency requirements.

### Federated Identity — SAML 2.0 / SCIM
Add SAML 2.0 SP support for enterprise SSO with providers such as Okta, Azure AD, and Google Workspace. Implement SCIM 2.0 user provisioning so IT admins can manage IliaGPT users from their identity provider directory. This includes automatic deprovisioning (account suspension on SCIM DELETE).

### On-Premise Deployment (Air-Gapped)
Ship a fully self-contained deployment bundle that requires zero outbound internet connectivity. This means bundled container images, a local Ollama instance as the default LLM backend, local MinIO for object storage, and a Helm chart for Kubernetes. Targeted at financial services, defense, and healthcare organizations with strict network isolation requirements.

### White-Label Support
Allow enterprise customers to rebrand IliaGPT with their own logo, color scheme, domain, and email sender. Configuration is applied via environment variables and a theme manifest file. Includes the ability to hide IliaGPT branding from the UI and API responses, and to configure a custom support URL in error messages.

### Agent Evaluation Framework
A built-in testing harness for evaluating agent quality: define test scenarios with expected tool calls, verify output against rubrics using an LLM-as-judge approach, track pass rates over time, and surface regressions in CI. This replaces ad-hoc manual testing for custom agent configurations.

### Multi-Language SDK Support
Publish official client SDKs in Python and Go alongside the existing TypeScript types. The SDKs will wrap the OpenAI-compatible `/v1/*` API surface and add IliaGPT-specific extensions (workspace management, memory CRUD, scheduled task management). Generated from the OpenAPI 3.1 spec to ensure they remain in sync with server changes.

### Granular Permission Scopes for API Keys
Extend API key management to support fine-grained permission scopes (e.g., `chat:read`, `chat:write`, `memory:read`, `tools:execute:web_search`). This enables organizations to issue minimal-privilege keys to external integrations, reducing the blast radius of a leaked key.

---

## Q4 2026 — v2.0.0 (Target: December 2026)

### IliaGPT API Platform for Third-Party Developers
Launch a public developer platform that extends beyond the current OpenAI-compatible `/v1/*` layer. The platform will include a Developer Portal with documentation, API key management, usage dashboards, and webhooks for async agent results. Rate-limit tiers will be decoupled from user tiers and priced independently. SDKs in TypeScript, Python, and Go will be published alongside an OpenAPI 3.1 specification.

### Community Marketplace for Agents and Skills
An in-app marketplace where community members can publish, install, and rate custom agents, MCP connectors, workflow templates, and prompt libraries. Monetization options for publishers (free / paid / pay-per-use). Quality gating via automated capability tests and manual review for verified publishers.

### Advanced Analytics Dashboard
A first-party analytics view for workspace administrators covering: LLM spend by provider and model, capability usage heatmaps, agent success/failure rates, active user trends, P50/P95/P99 response latencies, and budget burn-rate projections. Data is exportable as CSV and available via a `/api/admin/analytics` REST endpoint.

### SLA Tiers and Enterprise Support Portal
Formalize enterprise support commitments with documented SLA tiers (99.9% / 99.95% uptime commitments), incident response time targets, and a dedicated support portal with ticket tracking. Includes status page integration (Statuspage.io or self-hosted Uptime Kuma), on-call escalation runbooks, and named CSM assignments for enterprise accounts.

### Automated Compliance Documentation
Generate on-demand compliance evidence packages: data flow diagrams, access control matrices, encryption-at-rest and in-transit summaries, and audit log exports formatted for SOC 2 Type II, HIPAA, and GDPR audit requirements. This dramatically reduces the manual effort required for enterprise security questionnaires and certification audits.

---

## 2027 Vision

By 2027 we envision IliaGPT as the default AI layer for knowledge-work automation inside organizations: a platform where non-technical users compose sophisticated multi-agent workflows through natural language and a visual builder, where every business tool integration exists out of the box, and where enterprise security and compliance requirements are satisfied without custom engineering.

Key long-term bets:

**Agentic autonomy** — Agents that proactively surface insights, monitor conditions, and take actions without waiting to be prompted. Users define policies ("always notify me before sending external messages"), not code. Every autonomous action is recorded in a queryable audit trail with reasoning traces so humans can understand and override what happened.

**Cross-organization collaboration** — Agents that coordinate across organizational boundaries using privacy-preserving federated protocols. For example, a procurement agent at Company A can negotiate with a fulfillment agent at Company B without either company exposing their internal systems or data to the other.

**Multimodal-native** — Voice, image, video, and structured data treated as first-class inputs and outputs, not add-ons. Every capability in the platform should work equally well with speech input as with typed text. Document generation should produce not just text but presentation slides, interactive dashboards, and audio summaries depending on the delivery context.

**Edge and device inference** — Capability to run compact, distilled models on-device for low-latency, offline-first use cases (mobile, IoT, embedded systems). The IliaGPT mobile app should be able to run core chat functionality entirely on-device when offline, syncing to the server when connectivity is restored.

**Compliance by default** — Automatic data classification, retention policies, audit log export, and regulatory compliance documentation (SOC 2 Type II, HIPAA, GDPR, ISO 27001) built into the core platform, not bolted on after the fact. Compliance is a first-class product feature, not an enterprise add-on.

**Natural-language workflow authoring** — The v1.2.0 visual workflow builder is a stepping stone. The 2027 vision is a system where users describe a workflow in plain language ("every time a high-severity alert fires in PagerDuty, research the affected service, draft a runbook update, and post it to Confluence for review") and the system automatically generates, tests, and deploys the LangGraph workflow, asking clarifying questions only when the intent is ambiguous.

**Self-improving agents** — Agents that track their own failure modes across runs, identify patterns (e.g., "I consistently fail at tasks requiring real-time financial data"), and automatically surface capability gaps as improvement suggestions. The superAgent system introduced in v0.5.0 is the prototype; the 2027 vision is a fully closed feedback loop.

---

## Known Limitations and Accepted Technical Debt

This section documents areas of the codebase that are known to have limitations or accumulated technical debt. These are not bugs — they are deliberate tradeoffs that will be addressed in future versions.

**Agent context window management** — The current automatic summarization at 50 messages uses a single summarization pass that can lose fine-grained details. A more sophisticated approach (hierarchical summarization, selective memory, context compression) is planned but not yet scheduled.

**Single-region database** — IliaGPT currently assumes a single PostgreSQL primary. Multi-region active-active database setups (e.g., CockroachDB, Spanner, Neon branching) are not supported. For organizations with strict data residency in multiple regions simultaneously, the current architecture requires running separate isolated deployments.

**Tool call parallelism is provider-dependent** — Parallel function calling (multiple tool calls in a single LLM turn) is supported for OpenAI and Anthropic but not for all providers. For providers that do not support parallel tool calls, the agent falls back to sequential execution, which increases latency for tasks that could benefit from parallelism.

**Search index freshness** — Full-text and semantic search indexes are updated synchronously on message insert, which adds latency to the write path. For high-throughput deployments (many concurrent users), a queue-based async indexing pipeline would be more appropriate. This is a known scalability bottleneck beyond approximately 10,000 messages per minute.

**No streaming for document artifacts** — Document generation (DOCX, XLSX, PPTX) produces the complete file before delivering it to the client. There is no partial/streaming delivery for binary file artifacts. For very large documents, this can result in a long wait with no progress indication beyond a spinner.

---

## What We Won't Build

To set clear expectations, the following are explicit non-goals for IliaGPT:

- **We will not build a general-purpose social network or public forum.** IliaGPT is a workspace tool, not a consumer social platform.
- **We will not train foundation models.** IliaGPT orchestrates and routes across existing providers. Training large language models from scratch is outside our scope and resource envelope.
- **We will not build a proprietary LLM provider.** Our multi-provider philosophy means we remain neutral — we will not compete with the providers we integrate.
- **We will not build a visual analytics BI tool.** The planned analytics dashboard is for platform observability (spend, latency, usage), not a replacement for tools like Looker, Metabase, or Tableau.
- **We will not support piracy, circumvention of terms of service, or automated harassment.** Use-case restrictions are enforced in the terms of service and in content moderation tooling.
- **We will not build a crypto/blockchain integration.** There is no product need in our roadmap that requires on-chain computation or token mechanisms.

---

## How to Influence the Roadmap

The roadmap is shaped by the people who use IliaGPT. Here is how you can have an impact:

1. **Open a Feature Request** — Use the [feature request template](https://github.com/iliagpt/iliagpt/issues/new?template=feature_request.md). Be specific about the problem, the user story, and acceptance criteria. Requests with clear business justification and strong community support move up the priority queue.

2. **Upvote existing issues** — React with 👍 on GitHub issues to signal demand. We track reaction counts when prioritizing the backlog.

3. **Join the community** — Participate in Discussions on GitHub, or join the community Slack (link in the repository README). Monthly roadmap reviews are announced there.

4. **Submit a pull request** — The fastest way to get a feature built is to build it yourself. Check the [Contributing Guide](../CONTRIBUTING.md) and the [good first issue](https://github.com/iliagpt/iliagpt/labels/good%20first%20issue) label for entry points.

5. **Enterprise sponsorship** — If your organization has a specific capability need, commercial sponsorship can accelerate roadmap items. Contact the team via the email listed in the repository.

> Roadmap items are not commitments. Dates are targets, not deadlines. Priorities shift based on user feedback, technical discoveries, and team capacity. The `[Unreleased]` section of `CHANGELOG.md` is always the most accurate view of what is actively in development.

---

## Dependency and Technology Bets

The roadmap above rests on several long-term technology bets that are worth stating explicitly:

**LangGraph for orchestration** — We are committed to LangGraph as the agent DAG runtime for the foreseeable future. The graph-based model (nodes as agents, edges as control flow) has proven to be expressive enough for the orchestration patterns we need while remaining debuggable. If a successor project emerges with better support for streaming and human-in-the-loop, we will evaluate migration.

**PostgreSQL as the vector store** — Rather than adopting a dedicated vector database (Pinecone, Weaviate, Qdrant), IliaGPT uses pgvector within PostgreSQL. This eliminates an operational dependency and keeps data co-located with the relational data. At the scale most self-hosted deployments will encounter (millions, not billions, of vectors), pgvector with IVFFLAT indexes is sufficient. We will revisit this decision if performance data shows otherwise.

**TypeScript everywhere** — The monorepo uses TypeScript for both server (Node.js) and client (React). Shared types in `shared/` mean that schema changes propagate automatically across the stack. We have no plans to introduce a second primary language (Go, Rust) into the core server; the Python microservice for code execution is scoped intentionally.

**React 19 + Vite** — The frontend will track React major versions on a one-cycle lag (adopt React 20 after it has been stable for ~6 months). Vite will remain the build tool. We have no plans to migrate to a meta-framework (Next.js, Remix) since server-side rendering is not a priority for a workspace tool used by authenticated users.

**OpenAI-compatible API surface** — The `/v1/*` API is intentionally compatible with the OpenAI SDK. This choice is a bet that the OpenAI API format will remain the de-facto standard for LLM integration for the next several years. If a more widely adopted standard emerges (e.g., from an open standards body), IliaGPT will add an adapter layer.

---

## Versioning Policy

IliaGPT follows [Semantic Versioning](https://semver.org/):

- **Patch releases** (1.1.x) — Bug fixes, security patches, and minor documentation updates. Released on demand, no deprecation notice required.
- **Minor releases** (1.x.0) — New features that are backwards-compatible with existing API contracts and database schemas. Released on a roughly quarterly cadence. Migration scripts are provided for any schema changes. A release candidate (1.x.0-rc.1) is published for community testing before final release.
- **Major releases** (x.0.0) — Breaking changes to the public API, significant database schema changes requiring manual migration steps, or removal of deprecated features. A migration guide is published alongside the release. A minimum 3-month deprecation window is provided before breaking changes take effect.

Pre-release suffixes: `-alpha.N` (internal development), `-beta.N` (public testing, may have breaking changes), `-rc.N` (release candidate, API frozen).

Security releases may skip the normal release cadence and are published as patch releases to all supported minor versions simultaneously.

---

## Supported Version Matrix

| Version | Status | Support ends |
|---|---|---|
| 1.1.x (current) | Active — bug fixes, security patches | Until 1.3.0 release |
| 1.0.x | Maintenance — security patches only | 2026-07-01 |
| 0.5.x and earlier | End of life — no patches | Already ended |

Enterprise customers on IliaGPT Cloud receive extended support windows negotiated per contract.

---

## Contribution Opportunities

The following roadmap items are well-suited for community contributions. They are scoped to be achievable by a contributor who is familiar with the codebase but not a core maintainer. Each item links to an issue where design discussion can happen before implementation begins.

**Additional MCP Connectors** — The MCP connector interface is stable and well-documented. Adding a new connector for a service (e.g., Google Drive, Confluence, Airtable) requires implementing the manifest, auth, and tool definitions — typically 200–400 lines of TypeScript. This is the lowest-friction contribution path. Check the `connector:help-wanted` label in the issue tracker.

**LLM Provider Adapters** — Adding a new provider adapter requires implementing the `LLMProvider` interface in `server/llm/providers/` — handling the provider's request format, streaming protocol, and error types. The existing adapters are the reference implementation. New providers must include a test suite with mocked responses.

**Artifact Renderers** — The artifact system is designed to be extended with new renderer types. If you want to add a new auto-detected format (e.g., CSV preview, LaTeX math rendering, GeoJSON map rendering), implement a renderer in `client/src/components/artifacts/` following the `ArtifactRenderer` interface.

**i18n Translation Coverage** — IliaGPT ships with 103 locale files but many are incomplete for new strings added in recent releases. Native speakers who want to improve coverage for their language can submit PRs against the locale files in `client/src/locales/`. Run `npm run verify:i18n` to see which strings are missing per locale.

**Documentation Improvements** — Corrections, clarifications, examples, and additional troubleshooting guides in the `docs/` directory are always welcome. No code change required.

---

## Release Process

For contributors and release managers, here is a summary of the release process:

1. **Feature freeze** — 2 weeks before the target release date, the `main` branch enters feature freeze. Only bug fixes and documentation updates are merged during this period.
2. **Release candidate** — A `vX.Y.0-rc.1` tag is cut and published to npm. The community is invited to test the RC and report issues. The RC period lasts at least one week.
3. **Migration guide** — For minor and major releases, a migration guide is published in `docs/migrations/` documenting breaking changes, renamed environment variables, and required database migration steps.
4. **CHANGELOG update** — The `[Unreleased]` section of `CHANGELOG.md` is promoted to the new version heading with the release date.
5. **Final tag** — A `vX.Y.0` tag is pushed. GitHub Actions builds and publishes the release artifacts (Docker image, npm packages, GitHub Release with binaries for the Electron desktop app).
6. **Announcement** — Release notes are posted to GitHub Releases, the community Slack, and the project's social channels.

Patch releases (`vX.Y.Z`) follow a shortened process: no feature freeze, a 48-hour RC period, and immediate publish after CI passes.

---

## Feedback and Contact

- **Bug reports**: [github.com/iliagpt/iliagpt/issues](https://github.com/iliagpt/iliagpt/issues) — use the Bug Report template
- **Feature requests**: [github.com/iliagpt/iliagpt/issues](https://github.com/iliagpt/iliagpt/issues) — use the Feature Request template
- **Community discussion**: GitHub Discussions tab on the repository
- **Security vulnerabilities**: See `SECURITY.md` for responsible disclosure instructions — do not open public issues for security bugs
- **Enterprise inquiries**: Contact form at [iliagpt.io/enterprise](https://iliagpt.io/enterprise)
- **Monthly roadmap review**: Announced in the community Slack, open to all — no registration required

---

## Milestone Tracking

Progress against roadmap milestones is tracked publicly in the GitHub Milestones section of the repository. Each milestone corresponds to a planned release version and contains the full set of issues and pull requests targeted for that release.

- [v1.2.0 milestone](https://github.com/iliagpt/iliagpt/milestone/5) — Q2 2026
- [v1.3.0 milestone](https://github.com/iliagpt/iliagpt/milestone/6) — Q3 2026
- [v2.0.0 milestone](https://github.com/iliagpt/iliagpt/milestone/7) — Q4 2026

Issues without a milestone assignment are in the backlog. Upvote (👍 reaction) issues you care about to signal priority. The team reviews the backlog and assigns milestones during quarterly planning, which happens in the first week of each quarter (January, April, July, October).

---

## Acknowledgments

The IliaGPT roadmap reflects priorities shaped by feedback from users, contributors, and enterprise customers. Special thanks to everyone who has filed detailed feature requests, participated in design discussions, and submitted pull requests. Open source projects are built by their communities — this roadmap is yours as much as ours.

If you are using IliaGPT in production and would be willing to share a case study or serve as a reference customer, please reach out via the enterprise contact form. User stories from production deployments are invaluable for validating priorities and attracting contributors interested in solving real-world problems.

---

## Appendix: Capability Categories Reference

The 18 capability categories referenced throughout this roadmap and in GitHub issue templates:

| # | Category | Brief description |
|---|---|---|
| 1 | Chat & Conversation | Streaming chat, context window management, multi-chat workspace |
| 2 | Document Generation | Word, PDF, and structured report creation from agent instructions |
| 3 | Spreadsheet & Data | Excel generation, Python-based data analysis, formula evaluation |
| 4 | Presentation | PowerPoint (.pptx) slide deck generation from structured outlines |
| 5 | Code Generation & Execution | Multi-language coding assistance and sandboxed execution |
| 6 | Browser Automation | Full browser control via OpenClaw for scraping and UI automation |
| 7 | Web Search & Research | Internet access pipeline and multi-step deep-research agents |
| 8 | File & Document Processing | Ingestion, parsing, and Q&A over uploaded files and documents |
| 9 | Long-Term Memory | Cross-session fact extraction and semantic recall |
| 10 | Multi-Agent Orchestration | LangGraph DAG pipelines, Plan Mode, parallel sub-agents |
| 11 | Integrations & MCP Connectors | External service integrations via Model Context Protocol |
| 12 | Scheduled Tasks & Triggers | Cron and webhook-triggered autonomous agent runs |
| 13 | Image Understanding | Vision model analysis of uploaded images and screenshots |
| 14 | Audio / Voice | Speech transcription (Whisper) and text-to-speech output |
| 15 | Authentication & Security | OAuth, RBAC, CSRF, rate limiting, prompt injection defense |
| 16 | Deployment & Infrastructure | Docker, Kubernetes, horizontal scaling, observability |
| 17 | Developer API | OpenAI-compatible REST API, API key management, SDK |
| 18 | UI / UX | Web interface, artifact panel, hybrid search, presence indicators |
