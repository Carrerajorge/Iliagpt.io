---
name: Bug Report
about: Report a reproducible bug or unexpected behavior in IliaGPT
title: "[BUG] <short description of the issue>"
labels: ["bug", "needs-triage"]
assignees: []
---

<!--
Thank you for taking the time to file a bug report.
Please fill in as much detail as possible to help us reproduce and fix the issue quickly.
Remove any sections that are not applicable.
-->

## Describe the Bug

<!-- A clear and concise description of what the bug is. What did you observe? What did you expect? -->

**Summary:**


---

## Steps to Reproduce

<!-- Provide a numbered list of steps that reliably reproduce the issue. -->

1. Go to / open ...
2. Click on / type ...
3. Observe ...
4. (Add more steps as needed)

**Minimal reproduction (if applicable):**

```
Paste a minimal code snippet, curl command, or config that triggers the bug.
```

---

## Expected Behavior

<!-- What did you expect to happen? -->


---

## Actual Behavior

<!-- What actually happened instead? Include error messages verbatim. -->


---

## Screenshots / Logs

<!-- If applicable, add screenshots or paste relevant log output. -->
<!-- Redact any API keys, tokens, or personally-identifiable information before pasting. -->

<details>
<summary>Server logs (click to expand)</summary>

```
Paste server logs here
```

</details>

<details>
<summary>Browser console output (click to expand)</summary>

```
Paste browser console errors here
```

</details>

---

## Environment

| Field | Value |
|---|---|
| **IliaGPT version** | e.g. 1.1.0 |
| **Deployment** | Docker / bare metal / Electron desktop |
| **Operating System** | e.g. Ubuntu 22.04 / macOS 15.4 / Windows 11 |
| **Node.js version** | e.g. 22.4.0 (`node --version`) |
| **Browser (if UI bug)** | e.g. Chrome 124, Firefox 125, Safari 18 |
| **PostgreSQL version** | e.g. 16.2 |
| **Redis version** | e.g. 7.2 (or "not used") |

---

## LLM Provider Affected

<!-- Check all that apply -->

- [ ] OpenAI
- [ ] Anthropic (Claude)
- [ ] Google Gemini
- [ ] xAI (Grok)
- [ ] DeepSeek
- [ ] Cerebras
- [ ] Mistral
- [ ] Cohere
- [ ] Groq
- [ ] Together AI
- [ ] OpenRouter
- [ ] Fireworks AI
- [ ] Perplexity
- [ ] Azure OpenAI
- [ ] Ollama (local)
- [ ] LM Studio (local)
- [ ] Not provider-specific / unknown
- [ ] Other: ___________

---

## Relevant Configuration

<!-- Paste a **sanitized** excerpt from your .env file. Replace all secrets with `<REDACTED>`. -->
<!-- Only include variables relevant to the bug. -->

```env
NODE_ENV=
PORT=
DATABASE_URL=postgresql://postgres:<REDACTED>@localhost:5432/iliagpt
REDIS_URL=
# LLM provider(s) enabled
OPENAI_API_KEY=<REDACTED>
# Feature flags relevant to the bug
ENABLE_BROWSER_AUTOMATION=
ENABLE_CODE_EXECUTION=
ENABLE_LONG_TERM_MEMORY=
```

---

## Additional Context

<!-- Add any other context, links, or related issues here.
E.g. "This started after upgrading from v1.0.0 to v1.1.0" or "Only happens when using GPT-4o with tools enabled." -->


---

## Checklist

<!-- Please confirm the following before submitting. -->

- [ ] I have searched [existing issues](https://github.com/iliagpt/iliagpt/issues) and this is not a duplicate.
- [ ] I have read the [documentation](https://github.com/iliagpt/iliagpt/tree/main/docs) and the [FAQ](https://github.com/iliagpt/iliagpt/blob/main/docs/FAQ.md).
- [ ] I can reproduce this issue on the **latest released version** (v1.1.0).
- [ ] I have redacted all API keys, tokens, and sensitive data from this report.
- [ ] I have included all information requested above (or noted why it is not applicable).
