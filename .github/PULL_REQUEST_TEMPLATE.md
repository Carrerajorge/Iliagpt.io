<!--
Thank you for contributing to IliaGPT!
Please fill in this template completely before requesting review.
PRs without adequate description may be delayed or closed.
-->

## Summary

<!--
Provide a 1–3 sentence description of what this PR does and why.
Focus on the "what" and the "why", not the "how" — the code explains the how.
-->


---

## Type of Change

<!-- Check all that apply -->

- [ ] Bug fix (non-breaking change that fixes an issue)
- [ ] New feature (non-breaking change that adds functionality)
- [ ] Breaking change (fix or feature that causes existing functionality to change in a non-backwards-compatible way)
- [ ] Documentation update
- [ ] Refactor (no functional change, code quality improvement)
- [ ] Test (adding or improving tests with no production code change)
- [ ] Performance improvement
- [ ] Dependency update
- [ ] CI/CD / build system change
- [ ] Security fix

---

## Related Issues

<!--
Link to any issues this PR resolves, references, or is related to.
Use GitHub keywords to auto-close: Closes #123, Fixes #456, Resolves #789
-->

- Closes #
- Related to #

---

## Capability Categories Affected

<!-- Check all that apply -->

- [ ] **Chat & Conversation**
- [ ] **Document Generation**
- [ ] **Spreadsheet & Data**
- [ ] **Presentation**
- [ ] **Code Generation & Execution**
- [ ] **Browser Automation**
- [ ] **Web Search & Research**
- [ ] **File & Document Processing**
- [ ] **Long-Term Memory**
- [ ] **Multi-Agent Orchestration**
- [ ] **Integrations & MCP Connectors**
- [ ] **Scheduled Tasks & Triggers**
- [ ] **Image Understanding**
- [ ] **Audio / Voice**
- [ ] **Authentication & Security**
- [ ] **Deployment & Infrastructure**
- [ ] **Developer API**
- [ ] **UI / UX**

---

## Changes Made

<!-- Provide a bullet-point summary of what was changed, added, or removed. Be specific. -->

- 
- 
- 

---

## Testing

<!-- Describe how you tested this change. Check all that apply. -->

### Automated Tests

- [ ] Unit tests added for new logic
- [ ] Unit tests updated for modified logic
- [ ] Integration tests added / updated
- [ ] E2E (Playwright) tests added / updated
- [ ] All existing tests pass locally (`npm run test:run`)
- [ ] CI tests pass (`npm run test:ci:chat-core`)

### Manual Testing Steps

<!--
List the exact steps you performed to manually verify this change.
Include the environment (OS, Node version, browser, LLM provider) used.
-->

1. 
2. 
3. 

**Tested on:**
- OS: 
- Node: 
- Browser (if UI): 
- LLM provider(s): 

---

## Screenshots

<!-- For UI changes, include before/after screenshots or a short screen recording. Delete this section if not applicable. -->

| Before | After |
|--------|-------|
| _screenshot_ | _screenshot_ |

---

## Performance Impact

<!--
Does this change affect performance? Describe any benchmarks run, expected latency changes, memory impact, or database query changes.
Write "None" if there is no expected performance impact.
-->


---

## Security Considerations

<!--
Does this change affect security? Consider:
- New endpoints (authentication, authorization, rate limiting)
- User input handling (injection, XSS, CSRF)
- Secrets, credentials, or sensitive data handling
- Dependencies with known CVEs
Write "None" if there are no security implications.
-->


---

## Breaking Changes

<!--
If this is a breaking change, describe exactly what breaks and provide a migration path for users upgrading from the previous version.
Include any changes to environment variables, database schema, or public APIs.
Write "None" if this is not a breaking change.
-->


---

## Checklist

<!-- Ensure all boxes are checked before requesting review -->

- [ ] PR title follows [Conventional Commits](https://www.conventionalcommits.org/) format (e.g. `feat(agent): add parallel tool execution`)
- [ ] `CHANGELOG.md` updated under `[Unreleased]` with a summary of this change
- [ ] Relevant documentation updated (README, docs/, CLAUDE.md, etc.)
- [ ] No `console.log` or debug statements left in production code
- [ ] No `.env` secrets or API keys committed (check with `git diff` before pushing)
- [ ] TypeScript type errors resolved (`npm run check`)
- [ ] ESLint passes (`npm run lint`)
- [ ] CI is passing (GitHub Actions green)
- [ ] Self-review of diff completed — no unintended changes

---

## Reviewer Notes

<!--
Anything specific you want reviewers to pay attention to, areas of uncertainty, or known limitations of this approach.
Also note if there are follow-up issues you plan to open.
-->

