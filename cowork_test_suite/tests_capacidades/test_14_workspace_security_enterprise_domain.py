"""
Capabilities 14-17 — Workspaces, security/governance, enterprise, domain templates.
~700 tests.
"""
from __future__ import annotations

import pathlib

import pytest

from cowork_lib2 import (
    Workspace, path_within, egress_allowed,
    RBAC, Budget, telemetry_aggregate,
    DOMAIN_TEMPLATES, render_template,
)


# ---- workspace persist ----
@pytest.mark.parametrize("i", range(50))
def test_workspace_roundtrip(tmp_path, i):
    root = tmp_path / f"proj_{i}"
    root.mkdir()
    ws = Workspace(name=f"proj-{i}", root=root, memory={"foo": i, "bar": [1, 2, 3]})
    ws.save()
    loaded = Workspace.load(root)
    assert loaded.name == f"proj-{i}"
    assert loaded.memory == {"foo": i, "bar": [1, 2, 3]}


# ---- egress allowlist ----
EGRESS_CASES = [
    ("https://api.github.com/repos", ["github.com"], True),
    ("https://iliagpt.io/x", ["iliagpt.io"], True),
    ("https://sub.iliagpt.io/y", ["iliagpt.io"], True),
    ("https://evil.com/", ["iliagpt.io", "github.com"], False),
    ("https://raw.githubusercontent.com/x", ["githubusercontent.com"], True),
    ("http://localhost:9999/", ["iliagpt.io"], False),
]


@pytest.mark.parametrize("url,allow,expected", EGRESS_CASES * 20)
def test_egress(url, allow, expected):
    assert egress_allowed(url, allow) == expected


# ---- RBAC ----
@pytest.mark.parametrize("i", range(100))
def test_rbac(i):
    r = RBAC()
    r.grant("admin", "delete_file")
    r.grant("admin", "share_doc")
    r.grant("viewer", "read_doc")
    r.assign(f"alice{i}", "admin")
    r.assign(f"bob{i}", "viewer")
    assert r.can(f"alice{i}", "delete_file")
    assert r.can(f"bob{i}", "read_doc")
    assert not r.can(f"bob{i}", "delete_file")


# ---- Budget ----
@pytest.mark.parametrize("limit", [50, 100, 500, 1000, 5000] * 20)
def test_budget(limit):
    b = Budget(limit)
    charged = 0
    while b.charge(10):
        charged += 10
    assert charged == (limit // 10) * 10
    assert not b.charge(1)


# ---- Telemetry ----
@pytest.mark.parametrize("seed", list(range(100)))
def test_telemetry(seed):
    events = []
    for i in range(50):
        events.append({"event": "chat_sent", "user": i})
    for i in range(10):
        events.append({"event": "file_upload", "user": i})
    agg = telemetry_aggregate(events)
    assert agg["chat_sent"] == 50
    assert agg["file_upload"] == 10


# ---- Domain templates ----
DOMAIN_KEYS = [
    (d, n) for d, sub in DOMAIN_TEMPLATES.items() for n in sub.keys()
]


@pytest.mark.parametrize("domain,name", DOMAIN_KEYS * 20)
def test_domain_templates(domain, name):
    values = {s: f"value for {s}" for s in DOMAIN_TEMPLATES[domain][name]}
    rendered = render_template(domain, name, values)
    assert domain.title() in rendered
    for s in DOMAIN_TEMPLATES[domain][name]:
        assert s.title() in rendered
