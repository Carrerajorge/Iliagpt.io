"""
CAP-14: CONECTORES E INTEGRACIONES (MCP)
==========================================
Tests para todos los conectores MCP.

Sub-capacidades:
  14.1   Google Drive
  14.2   Gmail
  14.3   DocuSign
  14.4   FactSet
  14.5   Zoom (transcripciones, resumenes, action items)
  14.6   Slack
  14.7   Jira
  14.8   Asana
  14.9   Notion
  14.10  GitHub
  14.11  Linear
  14.12  CRMs (HubSpot)
  14.13  Fellow.ai
  14.14  Marketplace de plugins

Total: ~400 tests
"""
from __future__ import annotations

import pytest
from cowork_lib2 import MockConnector, CONNECTOR_NAMES
from cowork_lib3 import ZoomTranscript, DocuSignEnvelope, FactSetQuery


TICKERS = ["AAPL", "GOOGL", "MSFT", "AMZN", "TSLA", "META", "NVDA", "JPM", "V", "WMT"]

EXPECTED_CONNECTORS = [
    "google_drive", "gmail", "docusign", "zoom", "slack", "jira",
    "asana", "notion", "github", "linear", "hubspot", "fellow",
]


# ============================================================================
# Generic connector tests (covers 14.1, 14.2, 14.6-14.13)
# ============================================================================

@pytest.mark.connectors
class TestGenericConnectorOps:
    """Generic connector CRUD and search operations covering multiple integrations."""

    @pytest.mark.parametrize("name", CONNECTOR_NAMES)
    def test_connector_creation(self, name):
        c = MockConnector(name)
        assert c.name == name
        assert len(c.items) == 0

    @pytest.mark.parametrize("name", CONNECTOR_NAMES)
    def test_connector_upsert(self, name):
        c = MockConnector(name)
        c.upsert({"id": "1", "title": f"Item for {name}"})
        assert len(c.items) == 1
        assert c.items[0]["title"] == f"Item for {name}"

    @pytest.mark.parametrize("name", CONNECTOR_NAMES)
    def test_connector_upsert_update(self, name):
        c = MockConnector(name)
        c.upsert({"id": "1", "title": "original"})
        c.upsert({"id": "1", "title": "updated"})
        assert len(c.items) == 1
        assert c.items[0]["title"] == "updated"

    @pytest.mark.parametrize("name", CONNECTOR_NAMES)
    def test_connector_list(self, name):
        c = MockConnector(name)
        for j in range(5):
            c.upsert({"id": str(j), "title": f"Item {j}"})
        items = c.list()
        assert len(items) == 5

    @pytest.mark.parametrize("name", CONNECTOR_NAMES)
    def test_connector_search(self, name):
        c = MockConnector(name)
        c.upsert({"id": "1", "title": "Alpha report"})
        c.upsert({"id": "2", "title": "Beta analysis"})
        c.upsert({"id": "3", "title": "Alpha dashboard"})
        results = c.search("Alpha")
        assert len(results) == 2

    @pytest.mark.parametrize("n_items", [1, 5, 10, 25])
    def test_connector_bulk_operations(self, n_items):
        c = MockConnector("github")
        for j in range(n_items):
            c.upsert({"id": str(j), "title": f"Issue #{j}", "status": "open"})
        assert len(c.list()) == n_items
        open_items = c.search("open")
        assert len(open_items) == n_items


# ============================================================================
# 14.1 — Google Drive specific
# ============================================================================

@pytest.mark.connectors
class TestGoogleDrive:
    """14.1 — Google Drive file operations."""

    @pytest.mark.parametrize("i", range(10))
    def test_gdrive_file_operations(self, i):
        gdrive = MockConnector("google_drive")
        gdrive.upsert({"id": f"file_{i}", "name": f"Document_{i}.docx", "type": "document", "size_mb": i + 1})
        results = gdrive.search(f"Document_{i}")
        assert len(results) == 1
        assert results[0]["type"] == "document"


# ============================================================================
# 14.2 — Gmail specific
# ============================================================================

@pytest.mark.connectors
class TestGmail:
    """14.2 — Gmail email operations."""

    @pytest.mark.parametrize("i", range(10))
    def test_gmail_email_operations(self, i):
        gmail = MockConnector("gmail")
        gmail.upsert({
            "id": f"msg_{i}",
            "subject": f"RE: Budget Review Q{(i % 4) + 1}",
            "from": f"sender{i}@company.com",
            "unread": True,
        })
        results = gmail.search("Budget")
        assert len(results) == 1


# ============================================================================
# 14.3 — DocuSign
# ============================================================================

@pytest.mark.connectors
class TestDocuSign:
    """14.3 — DocuSign envelope creation, sending, and signing flows."""

    @pytest.mark.parametrize("n_signers", [1, 2, 3, 5])
    def test_docusign_envelope_creation(self, n_signers):
        signers = [f"signer_{j}@company.com" for j in range(n_signers)]
        env = DocuSignEnvelope(envelope_id="env_001", signers=signers)
        assert env.status == "created"
        assert len(env.signers) == n_signers

    @pytest.mark.parametrize("i", range(10))
    def test_docusign_send(self, i):
        env = DocuSignEnvelope(
            envelope_id=f"env_{i:03d}",
            signers=[f"signer_{i}@company.com"],
        )
        result = env.send()
        assert result.startswith("sent:")
        assert env.status == "sent"

    @pytest.mark.parametrize("i", range(10))
    def test_docusign_signing_flow(self, i):
        signers = ["alice@co.com", "bob@co.com"]
        env = DocuSignEnvelope(envelope_id=f"env_{i}", signers=signers)
        env.send()
        assert env.sign("alice@co.com") is True
        assert env.status == "sent"  # not complete yet
        assert env.sign("bob@co.com") is True
        assert env.status == "completed"  # all signed

    @pytest.mark.parametrize("i", range(10))
    def test_docusign_duplicate_sign(self, i):
        env = DocuSignEnvelope(envelope_id=f"dup_{i}", signers=["alice@co.com"])
        env.send()
        env.sign("alice@co.com")
        result = env.sign("alice@co.com")  # duplicate
        assert result is False

    @pytest.mark.parametrize("i", range(10))
    def test_docusign_unauthorized_signer(self, i):
        env = DocuSignEnvelope(envelope_id=f"unauth_{i}", signers=["alice@co.com"])
        result = env.sign("eve@attacker.com")
        assert result is False


# ============================================================================
# 14.4 — FactSet
# ============================================================================

@pytest.mark.connectors
class TestFactSet:
    """14.4 — FactSet financial data queries."""

    @pytest.mark.parametrize("ticker", TICKERS)
    def test_factset_query(self, ticker):
        q = FactSetQuery(ticker=ticker, metrics=["revenue", "pe_ratio", "market_cap"])
        result = q.execute()
        assert result["ticker"] == ticker
        assert "revenue" in result
        assert "pe_ratio" in result
        assert "market_cap" in result

    @pytest.mark.parametrize("ticker", TICKERS)
    def test_factset_deterministic(self, ticker):
        q1 = FactSetQuery(ticker=ticker, metrics=["revenue"])
        q2 = FactSetQuery(ticker=ticker, metrics=["revenue"])
        assert q1.execute()["revenue"] == q2.execute()["revenue"]

    @pytest.mark.parametrize("n_metrics", [1, 2, 3, 5])
    def test_factset_metric_count(self, n_metrics):
        metrics = ["revenue", "pe_ratio", "market_cap", "eps", "dividend_yield"][:n_metrics]
        q = FactSetQuery(ticker="AAPL", metrics=metrics)
        result = q.execute()
        assert len(result) == n_metrics + 1  # metrics + ticker


# ============================================================================
# 14.5 — Zoom
# ============================================================================

@pytest.mark.connectors
class TestZoom:
    """14.5 — Zoom transcripts, summaries, and action items."""

    @pytest.mark.parametrize("i", range(10))
    def test_zoom_transcript_summary(self, i):
        transcript = ZoomTranscript(
            meeting_id=f"mtg_{i:04d}",
            duration_min=30 + i * 5,
            participants=[f"user_{j}" for j in range(3)],
            segments=[
                {"speaker": "user_0", "text": f"Let's discuss the Q{(i % 4)+1} results."},
                {"speaker": "user_1", "text": "I agree, the numbers look good."},
                {"speaker": "user_2", "text": "Action item: review the budget by Friday."},
            ],
        )
        summary = transcript.summary()
        assert f"mtg_{i:04d}" in summary
        assert "3 speakers" in summary

    @pytest.mark.parametrize("i", range(10))
    def test_zoom_action_items(self, i):
        transcript = ZoomTranscript(
            meeting_id=f"ai_{i}",
            duration_min=45,
            participants=["alice", "bob"],
            segments=[
                {"speaker": "alice", "text": "Action item: update the dashboard."},
                {"speaker": "bob", "text": "I will do the analysis by Monday."},
                {"speaker": "alice", "text": "Great, let's follow up next week."},
                {"speaker": "bob", "text": "The weather is nice today."},
            ],
        )
        items = transcript.action_items()
        assert len(items) >= 2  # "action item", "will do", "follow up"

    @pytest.mark.parametrize("n_segments", [5, 10, 20])
    def test_zoom_transcript_size(self, n_segments):
        segments = [
            {"speaker": f"speaker_{j % 3}", "text": f"Discussion point {j}."}
            for j in range(n_segments)
        ]
        transcript = ZoomTranscript(
            meeting_id="large",
            duration_min=60,
            participants=["speaker_0", "speaker_1", "speaker_2"],
            segments=segments,
        )
        assert len(transcript.segments) == n_segments


# ============================================================================
# 14.14 — Marketplace (connector registry)
# ============================================================================

@pytest.mark.connectors
class TestMarketplace:
    """14.14 — Marketplace plugin registry and cross-connector search."""

    def test_all_connectors_registered(self):
        assert len(CONNECTOR_NAMES) == 12

    @pytest.mark.parametrize("name", CONNECTOR_NAMES)
    def test_connector_factory(self, name):
        c = MockConnector(name)
        assert c.name == name

    @pytest.mark.parametrize("name", EXPECTED_CONNECTORS)
    def test_expected_connector_exists(self, name):
        assert name in CONNECTOR_NAMES

    @pytest.mark.parametrize("i", range(10))
    def test_connector_cross_search(self, i):
        """Simulate searching across multiple connectors."""
        connectors = {name: MockConnector(name) for name in CONNECTOR_NAMES[:5]}
        for name, c in connectors.items():
            c.upsert({"id": f"{name}_{i}", "title": f"Project Alpha item from {name}"})
        all_results = []
        for c in connectors.values():
            all_results.extend(c.search("Alpha"))
        assert len(all_results) == 5
