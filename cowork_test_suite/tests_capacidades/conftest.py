"""
ILIAGPT.IO — Capability Test Suite Configuration
=================================================

Central pytest configuration providing:
  - Custom markers for capability categorization
  - Session-scoped fixtures for temp directories and artifacts
  - Test metadata collection for professional reporting
  - Automatic sub-capability tagging via node markers
"""
from __future__ import annotations

import json
import os
import pathlib
import time
from datetime import datetime

import pytest

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
BASE = pathlib.Path(__file__).parent
ARTIFACTS = BASE / "artifacts"
ARTIFACTS.mkdir(exist_ok=True)
REPORTS_DIR = BASE / "reports"
REPORTS_DIR.mkdir(exist_ok=True)

# ---------------------------------------------------------------------------
# Custom markers registration
# ---------------------------------------------------------------------------

def pytest_configure(config):
    """Register custom markers for capability classification."""
    markers = [
        "capability(name): Mark test with a capability category (CAP-01..CAP-18)",
        "subcapability(id): Mark test with a sub-capability identifier (e.g. '1.1')",
        "smoke: Minimal smoke tests that verify core functionality",
        "regression: Regression tests for previously-fixed defects",
        "slow: Tests that take >5 seconds (code execution, sandbox, etc.)",
        "integration: Tests requiring external services or binaries",
        "security: Security and governance validation tests",
        "enterprise: Enterprise-tier feature tests",
        "file_generation: Tests for document/file generation (CAP-01..CAP-05)",
        "data_science: Tests for analytics and ML capabilities (CAP-07)",
        "automation: Tests for browser/computer automation (CAP-10..CAP-11)",
        "connectors: Tests for MCP connector integrations (CAP-14)",
    ]
    for m in markers:
        config.addinivalue_line("markers", m)


# ---------------------------------------------------------------------------
# Session-scoped fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(scope="session")
def artifacts_dir():
    """Persistent directory for generated test artifacts (survives test run)."""
    return ARTIFACTS


@pytest.fixture(scope="session")
def reports_dir():
    """Directory for test reports and matrices."""
    return REPORTS_DIR


@pytest.fixture(scope="session")
def tmp_doc_dir(tmp_path_factory):
    """Session-scoped temporary directory for generated documents."""
    return tmp_path_factory.mktemp("generated_docs")


@pytest.fixture(scope="session")
def session_start_time():
    """Timestamp when the test session started."""
    return datetime.now()


# ---------------------------------------------------------------------------
# Capability result collection (pytest plugin)
# ---------------------------------------------------------------------------

class CapabilityCollector:
    """Collects per-capability results for the final matrix report."""

    def __init__(self):
        self.results: dict[str, dict] = {}
        self.start_time = time.time()

    def record(self, cap_id: str, cap_name: str, passed: bool, duration: float, nodeid: str):
        if cap_id not in self.results:
            self.results[cap_id] = {
                "id": cap_id,
                "name": cap_name,
                "passed": 0,
                "failed": 0,
                "skipped": 0,
                "errors": 0,
                "duration_s": 0.0,
                "test_details": [],
            }
        entry = self.results[cap_id]
        if passed:
            entry["passed"] += 1
        else:
            entry["failed"] += 1
        entry["duration_s"] += duration
        entry["test_details"].append({"nodeid": nodeid, "passed": passed, "duration": duration})


_collector = CapabilityCollector()


def pytest_runtest_makereport(item, call):
    """Hook: collect results per capability after each test."""
    if call.when != "call":
        return
    # Extract capability from filename: test_cap_NN_xxx.py -> CAP-NN
    module = item.module.__name__ if item.module else ""
    import re
    m = re.search(r"test_cap_(\d+)", module)
    if not m:
        return
    cap_num = int(m.group(1))
    cap_id = f"CAP-{cap_num:02d}"

    # Derive capability name from the test module docstring or filename
    cap_names = {
        1: "Excel Generation", 2: "PowerPoint Generation", 3: "Word Documents",
        4: "PDF Manipulation", 5: "Other Formats", 6: "File Management",
        7: "Data Science", 8: "Synthesis & Research", 9: "Format Conversion",
        10: "Browser Automation", 11: "Computer Use", 12: "Scheduled Tasks",
        13: "Mobile Dispatch", 14: "MCP Connectors", 15: "Plugins & Customization",
        16: "Code Execution", 17: "Sub-Agents", 18: "Security & Enterprise",
    }
    cap_name = cap_names.get(cap_num, f"Capability {cap_num}")
    passed = call.excinfo is None
    duration = call.duration if hasattr(call, "duration") else 0.0
    _collector.record(cap_id, cap_name, passed, duration, item.nodeid)


def pytest_terminal_summary(terminalreporter, config):
    """Hook: print capability matrix at the end of the pytest run."""
    if not _collector.results:
        return

    terminalreporter.section("ILIAGPT.IO Capability Matrix")
    total_p = total_f = 0

    header = f"  {'ID':<8} {'Status':>6}  {'Pass':>5} / {'Fail':>5}  {'Time':>7}  {'Capability':<30}"
    terminalreporter.write_line("")
    terminalreporter.write_line(header)
    terminalreporter.write_line("  " + "-" * (len(header) - 2))

    for cap_id in sorted(_collector.results.keys()):
        r = _collector.results[cap_id]
        total_p += r["passed"]
        total_f += r["failed"]
        status = "PASS" if r["failed"] == 0 else "FAIL"
        marker = "\033[92m" if status == "PASS" else "\033[91m"
        reset = "\033[0m"
        line = f"  {cap_id:<8} {marker}{status:>6}{reset}  {r['passed']:>5} / {r['failed']:>5}  {r['duration_s']:>6.1f}s  {r['name']:<30}"
        terminalreporter.write_line(line)

    terminalreporter.write_line("  " + "-" * (len(header) - 2))
    caps_passing = sum(1 for r in _collector.results.values() if r["failed"] == 0)
    total_caps = len(_collector.results)
    terminalreporter.write_line(f"  Capabilities: {caps_passing}/{total_caps} passing | Tests: {total_p} passed, {total_f} failed")
    terminalreporter.write_line("")

    # Save JSON artifact
    json_path = REPORTS_DIR / f"capability_matrix_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    summary = {
        "generated_at": datetime.now().isoformat(),
        "total_tests": total_p + total_f,
        "total_passed": total_p,
        "total_failed": total_f,
        "capabilities_passing": caps_passing,
        "capabilities_total": total_caps,
        "capabilities": {k: {kk: vv for kk, vv in v.items() if kk != "test_details"} for k, v in _collector.results.items()},
    }
    json_path.write_text(json.dumps(summary, indent=2, default=str))
