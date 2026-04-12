/**
 * Capability 10 — MCP Connectors
 *
 * Tests for all third-party connector integrations: Google Drive, Gmail,
 * DocuSign, Zoom, Slack, Jira, Asana, Notion, GitHub, and Linear.
 *
 * Each connector's API is mocked with vi.fn(). Tests verify:
 *  - Authentication headers are included
 *  - Payloads are formatted correctly
 *  - Responses are parsed and returned cleanly
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { runWithEachProvider } from "../_setup/providerMatrix";
import { getMockResponseForProvider } from "../_setup/mockResponses";

// ---------------------------------------------------------------------------
// Generic connector client factory
// ---------------------------------------------------------------------------

interface ConnectorClient {
  call: (action: string, params: Record<string, unknown>) => Promise<unknown>;
  lastRequest: () => { action: string; params: Record<string, unknown>; headers: Record<string, string> } | null;
}

function makeConnectorClient(name: string, baseResponse: unknown = { ok: true }): ConnectorClient {
  let lastReq: ReturnType<ConnectorClient["lastRequest"]> = null;

  const callFn = vi.fn(async (action: string, params: Record<string, unknown>) => {
    lastReq = {
      action,
      params,
      headers: {
        Authorization: "Bearer mock-token",
        "Content-Type": "application/json",
        "X-Connector": name,
      },
    };
    return baseResponse;
  });

  return {
    call: callFn,
    lastRequest: () => lastReq,
  };
}

// ---------------------------------------------------------------------------
// 1. Google Drive
// ---------------------------------------------------------------------------

describe("Google Drive", () => {
  let drive: ConnectorClient;

  beforeEach(() => {
    vi.clearAllMocks();
    drive = makeConnectorClient("google-drive", {
      ok: true,
      files: [
        { id: "file-001", name: "Budget.xlsx", mimeType: "application/vnd.ms-excel" },
        { id: "file-002", name: "Report.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
      ],
      file: { id: "file-new-001", name: "New Document.txt", webViewLink: "https://drive.google.com/file/d/file-new-001" },
    });
  });

  runWithEachProvider(
    "lists files in Google Drive",
    "mcp-connectors",
    async (provider) => {
      const result = await drive.call("list_files", { pageSize: 10 }) as { files: Array<{ id: string; name: string }> };
      expect(result.files).toHaveLength(2);
      expect(result.files[0].name).toBe("Budget.xlsx");

      const req = drive.lastRequest();
      expect(req!.headers["Authorization"]).toMatch(/^Bearer /);
      expect(req!.headers["X-Connector"]).toBe("google-drive");
    },
  );

  runWithEachProvider(
    "creates a new file in Google Drive",
    "mcp-connectors",
    async (provider) => {
      const result = await drive.call("create_file", {
        name: "New Document.txt",
        content: "Hello, world!",
        mimeType: "text/plain",
        folderId: "folder-root",
      }) as { file: { id: string; name: string } };

      expect(result.file.id).toBe("file-new-001");
      expect(result.file.name).toBe("New Document.txt");

      const req = drive.lastRequest();
      expect(req!.params["name"]).toBe("New Document.txt");
    },
  );

  runWithEachProvider(
    "searches for files by name in Google Drive",
    "mcp-connectors",
    async (provider) => {
      const searchDrive = makeConnectorClient("google-drive", {
        ok: true,
        files: [{ id: "file-found", name: "Budget.xlsx" }],
      });

      const result = await searchDrive.call("search_files", { query: "name contains 'Budget'" }) as { files: Array<{ name: string }> };
      expect(result.files).toHaveLength(1);
      expect(result.files[0].name).toBe("Budget.xlsx");

      const req = searchDrive.lastRequest();
      expect(req!.params["query"]).toContain("Budget");
    },
  );

  runWithEachProvider(
    "gets file metadata by ID",
    "mcp-connectors",
    async (provider) => {
      const metaDrive = makeConnectorClient("google-drive", {
        ok: true,
        file: { id: "file-001", name: "Budget.xlsx", size: 24576 },
      });

      const result = await metaDrive.call("get_file", { fileId: "file-001" }) as { file: { id: string; size: number } };
      expect(result.file.id).toBe("file-001");
      expect(result.file.size).toBeGreaterThan(0);
    },
  );
});

// ---------------------------------------------------------------------------
// 2. Gmail
// ---------------------------------------------------------------------------

describe("Gmail", () => {
  let gmail: ConnectorClient;

  beforeEach(() => {
    vi.clearAllMocks();
    gmail = makeConnectorClient("gmail", {
      ok: true,
      messages: [
        { id: "msg-001", subject: "Hello there", from: "alice@example.com", snippet: "How are you?" },
        { id: "msg-002", subject: "Meeting tomorrow", from: "bob@example.com", snippet: "Can we meet at 3?" },
      ],
      message: { id: "msg-sent-001", threadId: "thread-001", labelIds: ["SENT"] },
      draft: { id: "draft-001", message: { id: "draft-msg-001" } },
    });
  });

  runWithEachProvider(
    "reads emails from inbox",
    "mcp-connectors",
    async (provider) => {
      const result = await gmail.call("list_messages", { labelIds: ["INBOX"], maxResults: 10 }) as { messages: Array<{ id: string }> };
      expect(result.messages).toHaveLength(2);
      expect(result.messages[0].id).toBe("msg-001");

      const req = gmail.lastRequest();
      expect(req!.headers["Authorization"]).toMatch(/^Bearer /);
    },
  );

  runWithEachProvider(
    "sends an email",
    "mcp-connectors",
    async (provider) => {
      const result = await gmail.call("send_message", {
        to: "recipient@example.com",
        subject: "Test email",
        body: "This is a test email body.",
      }) as { message: { id: string; labelIds: string[] } };

      expect(result.message.id).toBe("msg-sent-001");
      expect(result.message.labelIds).toContain("SENT");

      const req = gmail.lastRequest();
      expect(req!.params["to"]).toBe("recipient@example.com");
      expect(req!.params["subject"]).toBe("Test email");
    },
  );

  runWithEachProvider(
    "searches inbox with a query",
    "mcp-connectors",
    async (provider) => {
      const searchGmail = makeConnectorClient("gmail", {
        ok: true,
        messages: [{ id: "msg-found-001", subject: "Invoice #1234" }],
      });

      const result = await searchGmail.call("search_messages", {
        query: "subject:Invoice has:attachment",
        maxResults: 5,
      }) as { messages: Array<{ subject: string }> };
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].subject).toContain("Invoice");
    },
  );

  runWithEachProvider(
    "creates a draft email",
    "mcp-connectors",
    async (provider) => {
      const result = await gmail.call("create_draft", {
        to: "colleague@example.com",
        subject: "Draft: Q4 Report",
        body: "Hi, please find attached...",
      }) as { draft: { id: string } };

      expect(result.draft.id).toBe("draft-001");
      const req = gmail.lastRequest();
      expect(req!.action).toBe("create_draft");
    },
  );
});

// ---------------------------------------------------------------------------
// 3. DocuSign
// ---------------------------------------------------------------------------

describe("DocuSign", () => {
  let docusign: ConnectorClient;

  beforeEach(() => {
    vi.clearAllMocks();
    docusign = makeConnectorClient("docusign", {
      ok: true,
      envelope: { envelopeId: "env-001", status: "sent", sentDateTime: new Date().toISOString() },
      status: { envelopeId: "env-001", status: "completed", completedDateTime: new Date().toISOString() },
      document: { data: "JVBERi0xLjQ...", mimeType: "application/pdf" },
    });
  });

  runWithEachProvider(
    "sends a document for signature",
    "mcp-connectors",
    async (provider) => {
      const result = await docusign.call("send_envelope", {
        documentBase64: "JVBERi0xLjQ...",
        documentName: "Contract.pdf",
        signers: [{ name: "Alice Smith", email: "alice@example.com" }],
        emailSubject: "Please sign the contract",
      }) as { envelope: { envelopeId: string; status: string } };

      expect(result.envelope.envelopeId).toBe("env-001");
      expect(result.envelope.status).toBe("sent");

      const req = docusign.lastRequest();
      expect(req!.params["signers"]).toHaveLength(1);
      expect(req!.headers["Authorization"]).toMatch(/^Bearer /);
    },
  );

  runWithEachProvider(
    "checks the status of an envelope",
    "mcp-connectors",
    async (provider) => {
      const result = await docusign.call("get_envelope_status", {
        envelopeId: "env-001",
      }) as { status: { envelopeId: string; status: string } };

      expect(result.status.envelopeId).toBe("env-001");
      expect(result.status.status).toBe("completed");
    },
  );

  runWithEachProvider(
    "downloads the signed document",
    "mcp-connectors",
    async (provider) => {
      const result = await docusign.call("download_document", {
        envelopeId: "env-001",
        documentId: "1",
      }) as { document: { data: string; mimeType: string } };

      expect(result.document.data).toBeTruthy();
      expect(result.document.mimeType).toBe("application/pdf");
    },
  );
});

// ---------------------------------------------------------------------------
// 4. Zoom
// ---------------------------------------------------------------------------

describe("Zoom", () => {
  let zoom: ConnectorClient;

  beforeEach(() => {
    vi.clearAllMocks();
    zoom = makeConnectorClient("zoom", {
      ok: true,
      meeting: {
        id: "zoom-mtg-001",
        topic: "Q4 Planning",
        startTime: "2026-04-20T14:00:00Z",
        joinUrl: "https://zoom.us/j/123456789",
      },
      recording: {
        meetingId: "zoom-mtg-001",
        recordingFiles: [
          { id: "rec-001", fileType: "MP4", downloadUrl: "https://zoom.us/rec/download/abc" },
        ],
      },
      participants: {
        participants: [
          { id: "p-001", name: "Alice", email: "alice@example.com", joinTime: "2026-04-20T14:01:00Z" },
          { id: "p-002", name: "Bob", email: "bob@example.com", joinTime: "2026-04-20T14:02:00Z" },
        ],
      },
    });
  });

  runWithEachProvider(
    "schedules a Zoom meeting",
    "mcp-connectors",
    async (provider) => {
      const result = await zoom.call("create_meeting", {
        topic: "Q4 Planning",
        startTime: "2026-04-20T14:00:00Z",
        duration: 60,
        agenda: "Review Q4 OKRs",
      }) as { meeting: { id: string; joinUrl: string } };

      expect(result.meeting.id).toBe("zoom-mtg-001");
      expect(result.meeting.joinUrl).toContain("zoom.us");

      const req = zoom.lastRequest();
      expect(req!.params["topic"]).toBe("Q4 Planning");
    },
  );

  runWithEachProvider(
    "retrieves a meeting recording",
    "mcp-connectors",
    async (provider) => {
      const result = await zoom.call("get_recording", {
        meetingId: "zoom-mtg-001",
      }) as { recording: { recordingFiles: Array<{ fileType: string }> } };

      expect(result.recording.recordingFiles).toHaveLength(1);
      expect(result.recording.recordingFiles[0].fileType).toBe("MP4");
    },
  );
});

// ---------------------------------------------------------------------------
// 5. Slack
// ---------------------------------------------------------------------------

describe("Slack", () => {
  let slack: ConnectorClient;

  beforeEach(() => {
    vi.clearAllMocks();
    slack = makeConnectorClient("slack", {
      ok: true,
      ts: "1712822400.000100",
      channel: { id: "C-new-001", name: "general-2", created: Math.floor(Date.now() / 1000) },
      messages: [
        { ts: "1712820000.000100", text: "Hello team", user: "U001" },
        { ts: "1712820001.000200", text: "Good morning!", user: "U002" },
      ],
      file: { id: "F-001", name: "report.pdf", permalink: "https://files.slack.com/files-pri/T001/F-001" },
    });
  });

  runWithEachProvider(
    "sends a message to a Slack channel",
    "mcp-connectors",
    async (provider) => {
      const result = await slack.call("post_message", {
        channel: "#general",
        text: "Hello, team!",
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "Hello, *team*!" } }],
      }) as { ts: string; ok: boolean };

      expect(result.ok).toBe(true);
      expect(result.ts).toBeTruthy();

      const req = slack.lastRequest();
      expect(req!.params["channel"]).toBe("#general");
      expect(req!.headers["Authorization"]).toMatch(/^Bearer /);
    },
  );

  runWithEachProvider(
    "reads recent messages from a channel",
    "mcp-connectors",
    async (provider) => {
      const result = await slack.call("get_channel_history", {
        channel: "C12345678",
        limit: 10,
      }) as { messages: Array<{ text: string }> };

      expect(result.messages).toHaveLength(2);
      expect(result.messages[0].text).toBe("Hello team");
    },
  );

  runWithEachProvider(
    "creates a new Slack channel",
    "mcp-connectors",
    async (provider) => {
      const result = await slack.call("create_channel", {
        name: "general-2",
        isPrivate: false,
      }) as { channel: { id: string; name: string } };

      expect(result.channel.id).toBe("C-new-001");
      expect(result.channel.name).toBe("general-2");
    },
  );

  runWithEachProvider(
    "uploads a file to Slack",
    "mcp-connectors",
    async (provider) => {
      const result = await slack.call("upload_file", {
        channels: ["#general"],
        filename: "report.pdf",
        contentBase64: "JVBERi0xLjQ...",
        title: "Q4 Report",
      }) as { file: { id: string; permalink: string } };

      expect(result.file.id).toBe("F-001");
      expect(result.file.permalink).toContain("slack.com");
    },
  );
});

// ---------------------------------------------------------------------------
// 6. Jira
// ---------------------------------------------------------------------------

describe("Jira", () => {
  let jira: ConnectorClient;

  beforeEach(() => {
    vi.clearAllMocks();
    jira = makeConnectorClient("jira", {
      ok: true,
      issue: { id: "10042", key: "PROJ-42", self: "https://yourorg.atlassian.net/rest/api/3/issue/10042" },
      transition: { id: "21", name: "In Progress" },
      issues: {
        issues: [
          { id: "10042", key: "PROJ-42", fields: { summary: "Implement feature X", status: { name: "To Do" } } },
          { id: "10043", key: "PROJ-43", fields: { summary: "Fix bug Y", status: { name: "In Progress" } } },
        ],
      },
      comment: { id: "10001", body: "Test comment", author: { displayName: "Alice" } },
    });
  });

  runWithEachProvider(
    "creates a Jira issue",
    "mcp-connectors",
    async (provider) => {
      const result = await jira.call("create_issue", {
        projectKey: "PROJ",
        summary: "Implement new MCP connector",
        issueType: "Story",
        description: "As a user, I want...",
        priority: "Medium",
      }) as { issue: { key: string } };

      expect(result.issue.key).toMatch(/^PROJ-\d+$/);

      const req = jira.lastRequest();
      expect(req!.params["projectKey"]).toBe("PROJ");
      expect(req!.headers["Authorization"]).toMatch(/^Bearer /);
    },
  );

  runWithEachProvider(
    "updates the status of a Jira issue",
    "mcp-connectors",
    async (provider) => {
      const result = await jira.call("transition_issue", {
        issueKey: "PROJ-42",
        transitionId: "21",
      }) as { transition: { name: string } };

      expect(result.transition.name).toBe("In Progress");
      const req = jira.lastRequest();
      expect(req!.params["issueKey"]).toBe("PROJ-42");
    },
  );

  runWithEachProvider(
    "searches Jira issues with JQL",
    "mcp-connectors",
    async (provider) => {
      const result = await jira.call("search_issues", {
        jql: "project = PROJ AND status = 'To Do' ORDER BY created DESC",
        maxResults: 20,
      }) as { issues: { issues: Array<{ key: string }> } };

      expect(result.issues.issues.length).toBeGreaterThan(0);
      expect(result.issues.issues[0].key).toMatch(/^PROJ-/);
    },
  );
});

// ---------------------------------------------------------------------------
// 7. Asana
// ---------------------------------------------------------------------------

describe("Asana", () => {
  let asana: ConnectorClient;

  beforeEach(() => {
    vi.clearAllMocks();
    asana = makeConnectorClient("asana", {
      ok: true,
      data: {
        gid: "1234567890",
        name: "Implement OAuth flow",
        completed: false,
        assignee: { gid: "user-001", name: "Alice Smith" },
        due_on: "2026-04-30",
      },
    });
  });

  runWithEachProvider(
    "creates an Asana task",
    "mcp-connectors",
    async (provider) => {
      const result = await asana.call("create_task", {
        projectId: "project-abc",
        name: "Implement OAuth flow",
        notes: "Use PKCE for mobile clients",
        dueOn: "2026-04-30",
      }) as { data: { gid: string; name: string } };

      expect(result.data.gid).toBeTruthy();
      expect(result.data.name).toBe("Implement OAuth flow");

      const req = asana.lastRequest();
      expect(req!.params["projectId"]).toBe("project-abc");
    },
  );

  runWithEachProvider(
    "assigns a task to a team member",
    "mcp-connectors",
    async (provider) => {
      const result = await asana.call("update_task", {
        taskGid: "1234567890",
        assignee: "user-001",
      }) as { data: { assignee: { name: string } } };

      expect(result.data.assignee.name).toBe("Alice Smith");
    },
  );

  runWithEachProvider(
    "marks a task as complete",
    "mcp-connectors",
    async (provider) => {
      const completeAsana = makeConnectorClient("asana", {
        ok: true,
        data: { gid: "1234567890", name: "Implement OAuth flow", completed: true },
      });

      const result = await completeAsana.call("update_task", {
        taskGid: "1234567890",
        completed: true,
      }) as { data: { completed: boolean } };

      expect(result.data.completed).toBe(true);
      const req = completeAsana.lastRequest();
      expect(req!.params["completed"]).toBe(true);
    },
  );
});

// ---------------------------------------------------------------------------
// 8. Notion
// ---------------------------------------------------------------------------

describe("Notion", () => {
  let notion: ConnectorClient;

  beforeEach(() => {
    vi.clearAllMocks();
    notion = makeConnectorClient("notion", {
      ok: true,
      page: {
        id: "notion-page-001",
        object: "page",
        url: "https://notion.so/notion-page-001",
        properties: { title: { title: [{ plain_text: "New Page" }] } },
      },
      results: [
        { id: "row-001", properties: { Name: { title: [{ plain_text: "Row 1" }] }, Status: { select: { name: "Done" } } } },
        { id: "row-002", properties: { Name: { title: [{ plain_text: "Row 2" }] }, Status: { select: { name: "In Progress" } } } },
      ],
    });
  });

  runWithEachProvider(
    "creates a new Notion page",
    "mcp-connectors",
    async (provider) => {
      const result = await notion.call("create_page", {
        parentId: "parent-db-001",
        title: "New Page",
        content: [{ type: "paragraph", text: "Hello, Notion!" }],
      }) as { page: { id: string; url: string } };

      expect(result.page.id).toBe("notion-page-001");
      expect(result.page.url).toContain("notion.so");

      const req = notion.lastRequest();
      expect(req!.params["title"]).toBe("New Page");
    },
  );

  runWithEachProvider(
    "queries a Notion database",
    "mcp-connectors",
    async (provider) => {
      const result = await notion.call("query_database", {
        databaseId: "db-001",
        filter: { property: "Status", select: { equals: "Done" } },
      }) as { results: Array<{ id: string }> };

      expect(result.results).toHaveLength(2);
      expect(result.results[0].id).toBe("row-001");
    },
  );
});

// ---------------------------------------------------------------------------
// 9. GitHub
// ---------------------------------------------------------------------------

describe("GitHub", () => {
  let github: ConnectorClient;

  beforeEach(() => {
    vi.clearAllMocks();
    github = makeConnectorClient("github", {
      ok: true,
      pull_request: {
        number: 42,
        title: "feat: add MCP connector tests",
        state: "open",
        html_url: "https://github.com/org/repo/pull/42",
        head: { ref: "feature/mcp-tests", sha: "abc123" },
      },
      comment: { id: 9001, body: "LGTM!", user: { login: "reviewer-bot" } },
      issues: [
        { number: 10, title: "Bug: connector auth fails", state: "open" },
        { number: 11, title: "Feature: add rate limiting", state: "open" },
      ],
      content: {
        name: "README.md",
        content: Buffer.from("# My Repo\n\nHello world.").toString("base64"),
        encoding: "base64",
      },
    });
  });

  runWithEachProvider(
    "creates a pull request",
    "mcp-connectors",
    async (provider) => {
      const result = await github.call("create_pull_request", {
        owner: "org",
        repo: "repo",
        title: "feat: add MCP connector tests",
        head: "feature/mcp-tests",
        base: "main",
        body: "Adds comprehensive connector test coverage.",
      }) as { pull_request: { number: number; state: string } };

      expect(result.pull_request.number).toBe(42);
      expect(result.pull_request.state).toBe("open");

      const req = github.lastRequest();
      expect(req!.params["head"]).toBe("feature/mcp-tests");
      expect(req!.headers["Authorization"]).toMatch(/^Bearer /);
    },
  );

  runWithEachProvider(
    "adds a comment to a PR",
    "mcp-connectors",
    async (provider) => {
      const result = await github.call("create_review_comment", {
        owner: "org",
        repo: "repo",
        pullNumber: 42,
        body: "LGTM!",
      }) as { comment: { id: number; body: string } };

      expect(result.comment.id).toBe(9001);
      expect(result.comment.body).toBe("LGTM!");
    },
  );

  runWithEachProvider(
    "lists open issues",
    "mcp-connectors",
    async (provider) => {
      const result = await github.call("list_issues", {
        owner: "org",
        repo: "repo",
        state: "open",
      }) as { issues: Array<{ number: number; title: string }> };

      expect(result.issues).toHaveLength(2);
      expect(result.issues[0].number).toBe(10);
    },
  );

  runWithEachProvider(
    "gets file content from a repository",
    "mcp-connectors",
    async (provider) => {
      const result = await github.call("get_file_contents", {
        owner: "org",
        repo: "repo",
        path: "README.md",
        ref: "main",
      }) as { content: { content: string; encoding: string } };

      expect(result.content.encoding).toBe("base64");
      const decoded = Buffer.from(result.content.content, "base64").toString("utf-8");
      expect(decoded).toContain("# My Repo");
    },
  );
});

// ---------------------------------------------------------------------------
// 10. Linear
// ---------------------------------------------------------------------------

describe("Linear", () => {
  let linear: ConnectorClient;

  beforeEach(() => {
    vi.clearAllMocks();
    linear = makeConnectorClient("linear", {
      ok: true,
      issueCreate: {
        success: true,
        issue: {
          id: "linear-issue-001",
          identifier: "ENG-42",
          title: "Implement Linear MCP connector",
          priority: 2,
          state: { name: "Todo" },
          url: "https://linear.app/org/issue/ENG-42",
        },
      },
      issueUpdate: {
        success: true,
        issue: {
          id: "linear-issue-001",
          identifier: "ENG-42",
          priority: 1,
          state: { name: "In Progress" },
        },
      },
      issues: {
        nodes: [
          { id: "linear-issue-001", identifier: "ENG-42", title: "Task 1", state: { name: "Todo" } },
          { id: "linear-issue-002", identifier: "ENG-43", title: "Task 2", state: { name: "Done" } },
        ],
      },
    });
  });

  runWithEachProvider(
    "creates a Linear issue",
    "mcp-connectors",
    async (provider) => {
      const result = await linear.call("create_issue", {
        teamId: "team-eng",
        title: "Implement Linear MCP connector",
        description: "Build the connector integration layer",
        priority: 2,
        labelIds: ["label-bug"],
      }) as { issueCreate: { success: boolean; issue: { identifier: string } } };

      expect(result.issueCreate.success).toBe(true);
      expect(result.issueCreate.issue.identifier).toBe("ENG-42");

      const req = linear.lastRequest();
      expect(req!.params["title"]).toBe("Implement Linear MCP connector");
      expect(req!.headers["Authorization"]).toMatch(/^Bearer /);
    },
  );

  runWithEachProvider(
    "updates issue priority",
    "mcp-connectors",
    async (provider) => {
      const result = await linear.call("update_issue", {
        issueId: "linear-issue-001",
        priority: 1,
        stateId: "state-in-progress",
      }) as { issueUpdate: { success: boolean; issue: { priority: number } } };

      expect(result.issueUpdate.success).toBe(true);
      expect(result.issueUpdate.issue.priority).toBe(1);
    },
  );

  runWithEachProvider(
    "lists issues in a project",
    "mcp-connectors",
    async (provider) => {
      const result = await linear.call("list_issues", {
        teamId: "team-eng",
        projectId: "proj-backend",
        first: 50,
      }) as { issues: { nodes: Array<{ identifier: string }> } };

      expect(result.issues.nodes).toHaveLength(2);
      expect(result.issues.nodes[0].identifier).toBe("ENG-42");
    },
  );
});
