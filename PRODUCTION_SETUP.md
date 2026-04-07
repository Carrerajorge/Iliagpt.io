# Production Setup Guide

Complete guide to configure IliaGPT's MCP App integrations for production.

## 1. Google Cloud Console

### Enable APIs
In [Google Cloud Console](https://console.cloud.google.com/apis/library):

1. **Gmail API** — enable for email search, read, and send
2. **Google Drive API** — enable for file search, read, and create
3. **Google Calendar API** — enable for event listing, creation, and deletion
4. **Google People API** — enable for contacts (optional)

### Create OAuth Credentials
Go to **APIs & Services > Credentials > Create Credentials > OAuth client ID**:

- **Application type**: Web application
- **Name**: IliaGPT Production
- **Authorized JavaScript origins**:
  ```
  https://your-domain.com
  ```
- **Authorized redirect URIs** (add ALL of these):
  ```
  https://your-domain.com/api/connectors/oauth/gmail/callback
  https://your-domain.com/api/connectors/oauth/google-drive/callback
  https://your-domain.com/api/connectors/oauth/google-calendar/callback
  https://your-domain.com/api/connectors/oauth/google-contacts/callback
  https://your-domain.com/api/oauth/google/callback
  ```

### Configure OAuth Consent Screen
Go to **APIs & Services > OAuth consent screen**:

1. **User type**: External (or Internal for Google Workspace)
2. **App name**: IliaGPT
3. **Scopes** — add these:
   ```
   https://www.googleapis.com/auth/gmail.readonly
   https://www.googleapis.com/auth/gmail.send
   https://www.googleapis.com/auth/gmail.modify
   https://www.googleapis.com/auth/drive.readonly
   https://www.googleapis.com/auth/drive.file
   https://www.googleapis.com/auth/calendar.readonly
   https://www.googleapis.com/auth/calendar.events
   https://www.googleapis.com/auth/userinfo.email
   https://www.googleapis.com/auth/userinfo.profile
   ```
4. **Test users**: Add your email while in "Testing" mode

> **Note**: Google requires app verification for production use with sensitive scopes (Gmail, Drive). Submit for verification once ready.

## 2. Slack App (Optional)

### Create Slack App
Go to [api.slack.com/apps](https://api.slack.com/apps):

1. **Create New App > From scratch**
2. **OAuth & Permissions > Redirect URLs**:
   ```
   https://your-domain.com/api/connectors/oauth/slack/callback
   ```
3. **Scopes** (Bot Token Scopes):
   ```
   channels:read
   channels:history
   chat:write
   search:read
   users:read
   ```
4. **Install to Workspace**

## 3. Environment Variables

### Required for MCP Apps

| Variable | Description | Where to get it |
|----------|-------------|-----------------|
| `GOOGLE_CLIENT_ID` | Google OAuth client ID | Google Cloud Console > Credentials |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret | Google Cloud Console > Credentials |
| `BASE_URL` | Your production URL (e.g. `https://iliagpt.io`) | Your hosting provider |
| `SESSION_SECRET` | Random 64-char hex string | `openssl rand -hex 32` |
| `TOKEN_ENCRYPTION_KEY` | 32+ char hex key for credential vault | `openssl rand -hex 32` |

### Optional for additional integrations

| Variable | Description |
|----------|-------------|
| `SLACK_CLIENT_ID` | Slack app client ID |
| `SLACK_CLIENT_SECRET` | Slack app client secret |
| `NOTION_CLIENT_ID` | Notion integration client ID |
| `NOTION_CLIENT_SECRET` | Notion integration secret |
| `GITHUB_CLIENT_ID` | GitHub OAuth app client ID |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth app client secret |
| `MICROSOFT_CLIENT_ID` | Azure AD app client ID |
| `MICROSOFT_CLIENT_SECRET` | Azure AD app client secret |
| `MICROSOFT_TENANT_ID` | Azure AD tenant ID |

### LLM Provider Keys (at least one required)

| Variable | Provider |
|----------|----------|
| `XAI_API_KEY` | xAI (Grok) |
| `GEMINI_API_KEY` | Google Gemini |
| `OPENAI_API_KEY` | OpenAI |
| `ANTHROPIC_API_KEY` | Anthropic (Claude) |
| `DEEPSEEK_API_KEY` | DeepSeek |
| `OPENROUTER_API_KEY` | OpenRouter (multi-provider) |

### Database

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string (with pgvector) |
| `DATABASE_READ_URL` | Read replica URL (optional) |

## 4. Replit Configuration

If deploying on Replit, add these as **Secrets**:

1. Go to **Tools > Secrets** in your Repl
2. Add each variable from the tables above
3. The `BASE_URL` should be your Repl's public URL:
   ```
   https://your-repl-name.replit.app
   ```
4. Update Google OAuth redirect URIs to use the Replit URL

## 5. Database Setup

```bash
# Run migrations
npm run db:bootstrap

# This will:
# 1. Enable pgvector extension
# 2. Run all Drizzle migrations
# 3. Create required tables including:
#    - integration_accounts (stores OAuth tokens)
#    - integration_providers (app catalog)
#    - integration_policies (user preferences)
#    - gmail_oauth_tokens (Gmail-specific storage)
```

## 6. Post-Deploy Verification

### Test OAuth Flow
1. Open the app in browser
2. Click the **Apps** section in the sidebar
3. Click on **Gmail** > **Conectar**
4. Complete Google OAuth flow
5. Verify Gmail shows as "CONECTADO"
6. Repeat for Google Drive and Google Calendar

### Test MCP Integration in Chat
After connecting apps, test in the chat:

```
User: "Busca en mi Gmail correos de amazon de la última semana"
→ Should invoke gmail_search tool and return results

User: "Busca en mi Drive el archivo de presupuesto"
→ Should invoke google_drive_search tool

User: "Qué eventos tengo mañana en mi calendario?"
→ Should invoke google_calendar_list_events tool

User: "Crea un evento en mi calendario para el viernes a las 3pm: Reunión de equipo"
→ Should invoke google_calendar_create_event tool (with confirmation)
```

### Test Document Generation
```bash
# Word
curl -X POST https://your-domain.com/api/documents/generate \
  -H "Content-Type: application/json" \
  -d '{"type":"word","title":"Test","content":"# Hello\nWorld"}' \
  -o test.docx

# Excel
curl -X POST https://your-domain.com/api/documents/generate \
  -H "Content-Type: application/json" \
  -d '{"type":"excel","title":"Test","content":"| A | B |\n|---|---|\n| 1 | 2 |"}' \
  -o test.xlsx

# PPT
curl -X POST https://your-domain.com/api/documents/generate \
  -H "Content-Type: application/json" \
  -d '{"type":"ppt","title":"Test","content":"# Slide 1\nHello\n# Slide 2\nWorld"}' \
  -o test.pptx
```

### Test Batch Status Endpoint
```bash
curl https://your-domain.com/api/apps/status \
  -H "Cookie: <your-session-cookie>"
# Should return: {"statuses":{"gmail":{"connected":true},...}}
```

## 7. Architecture Overview

```
User clicks "Conectar Gmail"
  → GET /api/connectors/oauth/gmail/start
  → Redirects to accounts.google.com (with ALL Google scopes merged)
  → User authorizes
  → GET /api/connectors/oauth/gmail/callback
  → Token exchanged and stored in credential_vault (AES-256-GCM)
  → User policy updated (enabledApps += gmail)
  → Redirect back to app

User says "busca en mi Gmail..."
  → Agent receives tools via getToolsForIntent() + getConnectorDeclarationsForUser()
  → LLM sees gmail_search tool and calls it
  → toolRegistry.execute("gmail_search", {q: "..."})
  → ConnectorExecutor resolves credential from vault
  → GET https://gmail.googleapis.com/gmail/v1/users/me/messages?q=...
  → Results returned to LLM → formatted response to user
```

## 8. Troubleshooting

| Issue | Solution |
|-------|----------|
| OAuth redirect error | Verify redirect URI matches exactly in Google Console |
| "not_configured" error | Check GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set |
| Token expired | System auto-refreshes with refresh_token; if missing, reconnect the app |
| Tool not appearing in chat | Check user's integration policy has the app enabled |
| CSRF error on connect | Ensure BASE_URL matches the origin of the request |
| Circuit breaker open | Too many failures; wait 30s for auto-recovery |
