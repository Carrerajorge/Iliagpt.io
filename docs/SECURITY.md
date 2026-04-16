# Security Policy

IliaGPT takes security seriously. This document describes our security model, threat mitigations, authentication architecture, data protection practices, and the process for reporting vulnerabilities.

---

## Table of Contents

1. [Security Model Overview](#security-model-overview)
2. [Threat Model](#threat-model)
3. [Authentication and Authorization](#authentication-and-authorization)
4. [Data Protection](#data-protection)
5. [Input Validation](#input-validation)
6. [Security Headers](#security-headers)
7. [Rate Limiting](#rate-limiting)
8. [Dependency Security](#dependency-security)
9. [Vulnerability Reporting](#vulnerability-reporting)
10. [Security Audit Checklist](#security-audit-checklist)
11. [Compliance](#compliance)

---

## Security Model Overview

IliaGPT employs a **defense-in-depth** strategy: multiple independent layers of security controls ensure that a failure in one layer does not expose the system to compromise.

```
┌─────────────────────────────────────────────────────────────────┐
│                        Internet / Clients                        │
└─────────────────────────┬───────────────────────────────────────┘
                          │ HTTPS (TLS 1.3)
┌─────────────────────────▼───────────────────────────────────────┐
│                     Reverse Proxy / CDN                          │
│          (TLS termination, DDoS mitigation, WAF rules)           │
└─────────────────────────┬───────────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────────┐
│                     Express.js Application                        │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────────┐   │
│  │   Helmet    │  │  Rate Limiter │  │  CSRF Protection     │   │
│  │  (headers)  │  │  (Redis)      │  │  (per-request token) │   │
│  └─────────────┘  └──────────────┘  └──────────────────────┘   │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────────┐   │
│  │  Auth       │  │  Input       │  │  Prompt Injection    │   │
│  │  Middleware │  │  Validation  │  │  Detection           │   │
│  │  (Passport) │  │  (Zod)       │  │                      │   │
│  └─────────────┘  └──────────────┘  └──────────────────────┘   │
└─────────────────────────┬───────────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────────┐
│                     Business Logic Layer                          │
│  ┌─────────────────────┐    ┌──────────────────────────────┐   │
│  │  SSRF Protection    │    │  Row-Level Authorization     │   │
│  │  (URL allowlist)    │    │  (per-query user_id checks)  │   │
│  └─────────────────────┘    └──────────────────────────────┘   │
│  ┌─────────────────────┐    ┌──────────────────────────────┐   │
│  │  DOMPurify Output   │    │  Tool Execution Sandbox      │   │
│  │  Sanitization       │    │  (FastAPI + resource limits) │   │
│  └─────────────────────┘    └──────────────────────────────┘   │
└─────────────────────────┬───────────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────────┐
│                     Data Layer                                    │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  PostgreSQL 16 + pgvector                                   │ │
│  │  Drizzle ORM (parameterized queries only, no raw SQL)       │ │
│  │  TDE or disk-level encryption at rest                       │ │
│  │  User data isolated by user_id on all queries               │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

Each layer is designed to be independently effective. Compromising the input validation layer does not bypass the database authorization layer. Compromising a single user session does not expose other users' data.

---

## Threat Model

The following threats have been explicitly considered in the design of IliaGPT's security controls.

### Prompt Injection

**Threat:** Malicious content in user messages or external data retrieved by agents causes the LLM to execute unintended instructions, leak data, or take harmful actions.

**Mitigations:**
- Keyword-based prompt injection detection middleware on all LLM inputs
- LLM-based secondary detection for sophisticated injection attempts
- Agent actions are bounded by explicit tool schemas — the LLM cannot invoke arbitrary system operations
- All LLM outputs are sanitized with DOMPurify before rendering in the client
- Tool execution is sandboxed in the FastAPI microservice with no access to production database credentials
- Sensitive system prompt content (session tokens, API keys) is never included in LLM context

### Server-Side Request Forgery (SSRF)

**Threat:** An attacker causes the server to make HTTP requests to internal network resources (metadata services, internal APIs, database ports) by supplying malicious URLs.

**Mitigations:**
- All URLs submitted for web retrieval pass through SSRF protection middleware before any HTTP request is made
- Private IP ranges are blocked at the middleware level: `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `127.0.0.0/8`, `169.254.0.0/16` (link-local / cloud metadata), `::1`, `fc00::/7`
- DNS rebinding protection: the resolved IP of a hostname is re-checked after DNS resolution
- URL allowlist available for enterprise deployments to restrict web access to approved domains only
- SSRF protection is applied before every outbound HTTP request made by agent tools

### SQL Injection

**Threat:** Malicious SQL code in user input manipulates database queries to access or modify unauthorized data.

**Mitigations:**
- **All database access uses Drizzle ORM's parameterized query builder.** Raw SQL strings are prohibited in application code.
- ESLint rule flags any usage of `db.execute()` with template literals for review
- PostgreSQL user for the application has minimal required permissions — no DDL privileges in production
- Input is validated with Zod schemas before reaching the database layer
- Database schema uses `uuid` primary keys to prevent enumeration attacks

### Cross-Site Scripting (XSS)

**Threat:** Malicious scripts injected via user-provided content execute in other users' browsers, enabling session theft or UI manipulation.

**Mitigations:**
- All user-generated content rendered in the React client is sanitized with DOMPurify before rendering
- React's JSX escaping provides a second layer of protection against XSS via standard rendering paths
- Content Security Policy (CSP) headers restrict the origins from which scripts can be loaded
- `dangerouslySetInnerHTML` usage is audited; all existing usages pass content through DOMPurify first
- Markdown rendering uses a sanitized renderer that strips `<script>` tags and dangerous attributes

### Cross-Site Request Forgery (CSRF)

**Threat:** A malicious website causes an authenticated user's browser to make state-changing requests to IliaGPT.

**Mitigations:**
- Per-request CSRF tokens required for all state-changing API endpoints (POST, PUT, PATCH, DELETE)
- CSRF token is delivered in a response header and must be echoed in subsequent requests
- `SameSite=Strict` cookie attribute provides browser-level CSRF protection on modern browsers
- Custom request headers (e.g., `X-CSRF-Token`) are not settable cross-origin via the browser's same-origin policy

### Session Hijacking

**Threat:** An attacker obtains a valid session token and impersonates an authenticated user.

**Mitigations:**
- Session cookies set with `HttpOnly` (no JavaScript access), `Secure` (HTTPS only), and `SameSite=Strict`
- Sessions stored in PostgreSQL via `connect-pg-simple` — server-side invalidation possible at any time
- Session secrets are minimum 64 random bytes, validated at startup via `server/config/env.ts`
- Anonymous user tokens use HMAC-SHA256 signatures (`X-Anonymous-Token` header) to prevent forgery
- Optional IP binding for high-security deployments: session invalidated if request IP changes
- Session rotation on privilege escalation (login, OAuth callback)

### Supply Chain Attacks

**Threat:** A compromised npm package introduces malicious code into the application.

**Mitigations:**
- `package-lock.json` is committed and used for deterministic installs (`npm ci` in CI)
- Dependabot configured for automated security update PRs on npm packages and GitHub Actions
- `npm audit` runs in CI and fails the build on high-severity vulnerabilities
- GitHub Actions use pinned SHA hashes for third-party actions, not floating version tags
- Subresource Integrity (SRI) for any CDN-served assets

### Unauthorized Data Access

**Threat:** A bug in authorization logic allows one user to access another user's data.

**Mitigations:**
- All database queries include explicit `WHERE user_id = :userId` clauses — row-level authorization enforced at the query layer
- `userId` is always derived from the authenticated session, never from request parameters
- pgvector embedding queries include user isolation: semantic search cannot cross user boundaries
- RBAC middleware validates role permissions before executing sensitive operations
- Automated tests cover authorization boundaries: attempting to access another user's resources returns 403

---

## Authentication and Authorization

### Authentication Strategies

IliaGPT uses [Passport.js](https://www.passportjs.org/) with multiple authentication strategies:

| Strategy | Use Case | Notes |
|---|---|---|
| Google OAuth 2.0 | Primary login for web users | Requires `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` |
| Microsoft OAuth | Enterprise SSO | Requires `MICROSOFT_CLIENT_ID` + `MICROSOFT_CLIENT_SECRET` |
| Auth0 | Flexible identity provider | Requires `AUTH0_DOMAIN` + `AUTH0_CLIENT_ID` |
| Local (username/password) | Fallback / admin accounts | Passwords hashed with bcrypt (cost factor 12) |
| API Key | Programmatic access to `/v1/` | Bearer token, stored as SHA-256 hash |

### Session Management

Sessions are stored in PostgreSQL via `connect-pg-simple`:

- Session data is serialized and stored in the `sessions` table
- Session IDs are 32-byte random values (cryptographically secure)
- Default session TTL: 7 days (sliding expiration resets on each request)
- Session is invalidated on logout by deleting the session record
- Concurrent session limit configurable per user tier

### Anonymous Users (Safari / ITP Support)

To support browsers with strict third-party cookie policies (Safari ITP), IliaGPT implements an anonymous user mechanism:

- `X-Anonymous-User-Id`: a UUID generated client-side and stored in `localStorage`
- `X-Anonymous-Token`: HMAC-SHA256 of the user ID using a server-side secret
- The server validates the HMAC signature on every request using this mechanism
- Anonymous sessions are promoted to full accounts on OAuth login

### API Key Authentication

API keys are used for programmatic access to the OpenAI-compatible `/v1/` endpoints:

- Format: `ilgpt_` followed by 32 cryptographically random alphanumeric characters
- Keys are **never stored in plaintext**. Only the SHA-256 hash is stored in the `api_keys` table.
- The first 8 characters of the key (after the prefix) are stored as a display prefix for identification
- Keys are transmitted via the `Authorization: Bearer ilgpt_...` header
- Keys can be scoped to specific permissions and rate-limited independently
- Compromised keys can be revoked instantly by deleting the hash from the database

### Role-Based Access Control (RBAC)

| Role | Permissions |
|---|---|
| `admin` | Full access to all resources, user management, system config |
| `user` | Access to own resources, standard API usage |
| `viewer` | Read-only access to shared resources |

Organization-level roles extend this with team-scoped permissions. Role checks are enforced by middleware on all sensitive routes.

---

## Data Protection

### Data at Rest

- **Recommended:** PostgreSQL Transparent Data Encryption (TDE) or disk-level encryption (LUKS on Linux, FileVault on macOS, BitLocker on Windows Server)
- pgvector embeddings containing semantic representations of user messages are stored encrypted alongside message data
- Backups are encrypted before transfer to object storage
- Database backup files use AES-256 encryption

### Data in Transit

- **TLS 1.3 is required** for all client-server communication. TLS 1.2 and below are rejected at the reverse proxy level.
- HSTS header enforces HTTPS for all future requests: `max-age=31536000; includeSubDomains`
- Internal service communication (app server ↔ PostgreSQL, app server ↔ Redis) should use TLS in production environments. At minimum, these services must be on an isolated network segment.

### Secrets Management

| Secret | Storage | Notes |
|---|---|---|
| `SESSION_SECRET` | Environment variable | Minimum 64 random bytes. Rotate quarterly. |
| LLM API keys | Environment variable | Never logged. Validated at startup. |
| API keys (user) | Database (SHA-256 hash) | Plaintext only shown once at creation. |
| OAuth secrets | Environment variable | Rotated per OAuth provider's recommendations. |
| Database passwords | Environment variable | Principle of least privilege per database user. |

Secrets must **never** be:
- Committed to git (`.gitignore` covers `.env` files; `gitleaks` scans in CI)
- Logged in application logs (log scrubbing middleware strips known secret patterns)
- Included in error messages returned to clients
- Passed as URL parameters

### PII Handling

- User email addresses are stored as-is in the `users` table
- For enterprise deployments handling sensitive PII, field-level encryption is recommended using a KMS-managed key
- User-facing data deletion (`DELETE /api/user`) removes all user records, messages, memories, and embeddings
- Data export (`GET /api/user/export`) returns a GDPR-compliant data package in JSON format

### Memory and Embeddings

- Long-term memory facts are stored in `user_long_term_memories` with the associated `user_id`
- pgvector similarity searches always include `WHERE user_id = :userId` — no cross-user data leakage via semantic search
- Memory entries can be individually deleted via `DELETE /api/memories/:id`
- All memories for a user are deleted when the user account is deleted

---

## Input Validation

All inputs entering the system are validated at the API boundary using Zod schemas defined in `shared/schema.ts` or co-located schema files.

### API Inputs

Every route handler validates its request body, query parameters, and path parameters against a Zod schema before processing. Invalid inputs return `400 Bad Request` with a structured error response listing validation failures. This prevents malformed data from reaching business logic or the database.

### File Uploads

| Check | Implementation |
|---|---|
| MIME type check | `Content-Type` header validation |
| Magic bytes check | File header bytes inspected regardless of declared type |
| File size limit | Default 100MB; configurable per endpoint |
| Filename sanitization | Path traversal characters stripped |
| Virus scanning | ClamAV integration available for enterprise deployments |

### Code Execution

User-submitted code runs in the FastAPI SSE microservice sandbox, which enforces:

- **CPU time limit:** Configurable (default: 30s per execution)
- **Memory limit:** Configurable (default: 512MB)
- **Network access:** Disabled by default for code execution sandbox
- **Filesystem access:** Read-only, limited to a temporary working directory
- **No subprocess spawning** in the default sandbox profile

### URL Inputs (SSRF Protection)

Before making any HTTP request based on a user-supplied URL:

1. Parse the URL and reject non-HTTP(S) schemes (`file://`, `ftp://`, `gopher://`, etc.)
2. Resolve the hostname via DNS
3. Check the resolved IP against the private range blocklist
4. Check the URL against the domain allowlist (if configured)
5. Re-check the resolved IP after the connection is established (anti-DNS-rebinding)

### Prompt Injection Detection

LLM inputs are analyzed for prompt injection patterns before being sent to the model:

1. **Static pattern matching:** Known injection phrases (e.g., "ignore previous instructions", "you are now DAN") are detected and flagged
2. **LLM-based detection:** A lightweight classifier evaluates suspicious inputs for injection attempts
3. **Flagged inputs** are either blocked (configurable) or logged for review, and the user is notified that their input was flagged

---

## Security Headers

Helmet.js is configured to set the following security headers on all responses:

### Content-Security-Policy

```
default-src 'self';
script-src 'self' 'nonce-{random}';
style-src 'self' 'unsafe-inline';
img-src 'self' data: https:;
connect-src 'self' wss: https://api.openai.com https://api.anthropic.com;
frame-ancestors 'none';
form-action 'self';
base-uri 'self';
```

The `nonce-{random}` approach is used for inline scripts required by the application framework.

### Other Headers

| Header | Value | Purpose |
|---|---|---|
| `X-Frame-Options` | `DENY` | Prevent clickjacking |
| `X-Content-Type-Options` | `nosniff` | Prevent MIME sniffing |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` | Enforce HTTPS |
| `Referrer-Policy` | `same-origin` | Limit referrer leakage |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` | Restrict browser features |
| `X-XSS-Protection` | `0` | Disabled (CSP is sufficient; XSS Auditor is deprecated) |
| `Cross-Origin-Opener-Policy` | `same-origin` | Protect against cross-origin attacks |
| `Cross-Origin-Resource-Policy` | `same-origin` | Restrict cross-origin resource loading |

---

## Rate Limiting

Rate limiting uses a Redis-backed sliding window algorithm. Limits are applied per IP address for unauthenticated requests and per user ID for authenticated requests.

### Endpoint Limits

| Endpoint Category | Free Tier | Pro Tier | Enterprise |
|---|---|---|---|
| Authentication (`/auth/*`) | 10 req/5min | 20 req/5min | 50 req/5min |
| Chat API (`/api/chats/*`) | 60 req/min | 300 req/min | Unlimited |
| LLM API (`/v1/*`) | 60 req/min | 300 req/min | Custom |
| File Upload | 10 req/hour | 50 req/hour | Custom |
| Admin endpoints | — | — | 100 req/min |

### LLM Budget Limits

LLM usage is capped by cost per day:

| Tier | Daily LLM Budget |
|---|---|
| Free | $0.50/day |
| Pro | $5.00/day |
| Enterprise | $50.00/day |

Budget is tracked per user and enforced in `server/llm/smartRouter.ts`. When a budget is exhausted, requests return `429 Too Many Requests` with a `Retry-After` header indicating when the budget resets (midnight UTC).

### Abuse Protection

- Repeated failed authentication attempts trigger progressive delays (exponential backoff)
- IP addresses exceeding 5x the rate limit threshold are temporarily blocked (15-minute cooldown)
- Suspicious patterns (credential stuffing, enumeration) trigger alerts to the security team

---

## Dependency Security

### Automated Scanning

- **Dependabot** is configured for both npm packages and GitHub Actions workflows. It opens automated PRs for security updates within 24 hours of a CVE being published.
- **`npm audit`** runs in every CI build. Builds fail on high-severity vulnerabilities in production dependencies.
- **`gitleaks`** scans commits for accidentally committed secrets (API keys, passwords, tokens).

### Policy

- No known-critical or high-severity vulnerabilities are permitted in production dependencies
- Medium-severity vulnerabilities must be triaged within 7 days
- Lock files (`package-lock.json`) are committed and CI uses `npm ci` for deterministic installs
- Dependencies are reviewed during PR review — new large dependencies require justification

### GitHub Actions Security

- Third-party actions are pinned to specific commit SHAs (not version tags, which are mutable)
- The `GITHUB_TOKEN` is granted minimum required permissions (`contents: read` by default)
- Secrets are never echoed in workflow step outputs

---

## Vulnerability Reporting

### How to Report

If you discover a security vulnerability in IliaGPT, please report it responsibly:

**Email:** security@iliagpt.io

Please **do not** open a public GitHub issue for security vulnerabilities, as this exposes the vulnerability to all users before a fix is available.

### What to Include in Your Report

- Description of the vulnerability and its potential impact
- Steps to reproduce the issue
- Affected versions or components
- Any proof-of-concept code or screenshots (optional but helpful)
- Your preferred contact method for follow-up

### Response SLA

| Stage | Timeline |
|---|---|
| Acknowledgment | Within 24 hours of receipt |
| Initial triage | Within 72 hours |
| Status update | Every 7 days until resolved |
| Fix for critical issues | Within 14 days |
| Fix for high issues | Within 30 days |
| Fix for medium/low issues | Best effort, typically within 90 days |

### Responsible Disclosure Policy

We ask that you:
- Give us reasonable time to fix the issue before public disclosure
- Not access, modify, or delete user data beyond what is needed to demonstrate the vulnerability
- Not perform actions that could harm the availability of the service (DoS)
- Not use social engineering against IliaGPT staff or users

In return, we commit to:
- Respond promptly and transparently
- Not take legal action against researchers acting in good faith
- Credit researchers in the security advisory (if desired)

### Bug Bounty

IliaGPT operates a bug bounty program. Rewards are based on severity:

| Severity | Example | Reward Range |
|---|---|---|
| Critical | Remote code execution, authentication bypass | $500 – $2,000 |
| High | SQL injection, stored XSS, privilege escalation | $200 – $500 |
| Medium | CSRF, reflected XSS, IDOR with limited impact | $50 – $200 |
| Low | Information disclosure, rate limit bypass | Up to $50 |

**Scope includes:** The IliaGPT web application (`app.iliagpt.io`), the API (`api.iliagpt.io`), and the Chrome extension.

**Out of scope:** Denial of service, social engineering, physical attacks, issues in third-party services (OpenAI, Google OAuth, etc.), and vulnerabilities requiring physical device access.

---

## Security Audit Checklist

Use this checklist before deploying to production or after major changes:

### Authentication and Sessions
- [ ] `SESSION_SECRET` is at least 64 random bytes and not a guessable string
- [ ] Session cookies are `HttpOnly`, `Secure`, and `SameSite=Strict`
- [ ] OAuth callback URLs are exactly registered with the OAuth provider (no wildcards)
- [ ] Anonymous user HMAC tokens use a secret separate from `SESSION_SECRET`
- [ ] API keys in the database are stored as SHA-256 hashes, not plaintext
- [ ] CSRF tokens are validated on all state-changing endpoints

### Network and Infrastructure
- [ ] TLS 1.3 is enforced; TLS 1.2 and below are disabled at the reverse proxy
- [ ] HSTS header is present with `includeSubDomains`
- [ ] Internal services (PostgreSQL, Redis) are not accessible from the public internet
- [ ] Cloud metadata endpoint (`169.254.169.254`) is in the SSRF blocklist

### Application Security
- [ ] All API endpoints validate inputs with Zod schemas
- [ ] No raw SQL strings — all queries use Drizzle's query builder
- [ ] All database queries include `user_id` scoping for user data
- [ ] File upload endpoints check magic bytes, not just `Content-Type` header
- [ ] Code execution routes through the FastAPI sandbox, not the main process
- [ ] DOMPurify sanitization applied to all user-generated content rendered in the client
- [ ] CSP header does not contain `unsafe-eval` or overly broad `script-src` directives

### Secrets and Configuration
- [ ] No secrets are present in `git log` (run `gitleaks detect`)
- [ ] `.env` files are in `.gitignore` and not committed
- [ ] All required environment variables are validated by the Zod schema at startup
- [ ] LLM API keys are not logged in application logs or error responses

### Dependencies
- [ ] `npm audit` shows no high or critical vulnerabilities
- [ ] All GitHub Actions use SHA-pinned third-party actions
- [ ] `package-lock.json` is committed and up to date

### Monitoring and Incident Response
- [ ] Application logs capture authentication events (login, logout, failed attempts)
- [ ] Rate limiting alerts are configured for anomalous traffic spikes
- [ ] Security contact (`security@iliagpt.io`) is reachable and monitored
- [ ] Runbook exists for credential rotation and session invalidation

---

## Compliance

### GDPR (General Data Protection Regulation)

IliaGPT includes the following controls to support GDPR compliance for EU users:

| Requirement | Implementation |
|---|---|
| Right to erasure | `DELETE /api/user` removes all user data (account, messages, memories, embeddings) |
| Data portability | `GET /api/user/export` returns a structured JSON data package |
| Data minimization | Only data necessary for the service is collected |
| Consent | Privacy policy and cookie consent managed via configurable consent hooks |
| Data Processing Agreement | DPA template available for enterprise customers upon request |
| Data residency | Database region is configurable; EU region available |
| Breach notification | Incident response process includes 72-hour notification obligation |

**Sub-processors:** IliaGPT uses third-party LLM APIs (OpenAI, Anthropic, Google) as sub-processors. Data processing agreements with these providers are maintained. Enterprise customers may configure a self-hosted or EU-based LLM endpoint to avoid data leaving their jurisdiction.

### SOC 2 Type II Considerations

The following controls support SOC 2 Trust Service Criteria:

**Security (CC6):**
- Logical access controlled via RBAC and authentication middleware
- Encryption at rest and in transit
- Vulnerability management via Dependabot and `npm audit`
- Change management via PR review process and CI/CD gates

**Availability (A1):**
- Circuit breakers on LLM providers prevent cascading failures
- Redis pub/sub for multi-instance coordination
- Database read replicas supported via `DATABASE_READ_URL`
- Health check endpoints (`/health`) for load balancer integration

**Confidentiality (C1):**
- Row-level data isolation per user
- API key hashing
- TLS in transit
- Audit logging for data access events

**Processing Integrity (PI1):**
- All API inputs validated with Zod schemas
- Database constraints enforce data integrity
- Transaction-safe operations for critical writes

A formal SOC 2 Type II audit report is available to enterprise customers under NDA. Contact sales@iliagpt.io.

### HIPAA Considerations

For healthcare deployments handling Protected Health Information (PHI):

- A Business Associate Agreement (BAA) is required before processing PHI. Contact compliance@iliagpt.io.
- Audit logging must be enabled: all access to records containing PHI must be logged with user identity, timestamp, and action.
- Encryption at rest is **required** for HIPAA compliance, not merely recommended.
- PHI must not be included in LLM prompts unless a BAA is in place with the LLM provider.
- Automatic session timeouts (15 minutes) are required for workstations accessing PHI.
- Dedicated database instances with restricted access are required for PHI-containing deployments.

IliaGPT's default configuration is not HIPAA-compliant out of the box. A HIPAA configuration guide is available for enterprise customers under a signed BAA.
