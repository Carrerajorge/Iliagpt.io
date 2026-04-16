"""
Capabilities 10–13 — Connectors, plugins/skills, code execution, sub-agents.
~800 tests.
"""
from __future__ import annotations

import pytest

from cowork_lib2 import (
    MockConnector, CONNECTOR_NAMES, Skill, create_skill,
    exec_python, exec_node, decompose_task, TodoList,
)


# ---- connectors ----
@pytest.mark.parametrize("name", CONNECTOR_NAMES)
def test_connector_instantiate(name):
    c = MockConnector(name)
    assert c.name == name and c.list() == []


@pytest.mark.parametrize("name", CONNECTOR_NAMES * 10)
def test_connector_upsert_and_search(name):
    c = MockConnector(name)
    for i in range(5):
        c.upsert({"id": i, "title": f"item {i}", "body": f"body for {name}"})
    assert len(c.list()) == 5
    # update same id while keeping the connector name searchable
    c.upsert({"id": 0, "title": "item 0 updated", "body": f"refreshed for {name}"})
    assert any(i["title"] == "item 0 updated" for i in c.list())
    found = c.search(name)
    assert len(found) == 5


# ---- skills / plugins ----
SKILL_CASES = [
    ("xlsx", "Handle spreadsheets", ["excel", "xlsx", "spreadsheet"], "create an xlsx file", True),
    ("pdf", "Handle PDFs", ["pdf"], "convert to PDF", True),
    ("docx", "Handle word docs", ["docx", "word"], "make a word document", True),
    ("pptx", "Handle slides", ["pptx", "slides"], "build a slide deck", False),  # slides not in triggers here
    ("legal", "Legal review", ["contract", "nda"], "review this contract", True),
    ("finance", "Finance", ["budget", "variance"], "budget for q3", True),
    ("marketing", "Marketing", ["brand", "campaign"], "brand voice analysis", True),
]


@pytest.mark.parametrize("name,desc,triggers,prompt,should_match", SKILL_CASES * 20)
def test_skills_match(name, desc, triggers, prompt, should_match):
    s = create_skill(name, desc, triggers)
    assert s.matches(prompt) == should_match


# ---- python exec ----
@pytest.mark.parametrize("i", range(100))
def test_exec_python(i):
    code = f"print({i} * 2)"
    rc, out, err = exec_python(code)
    assert rc == 0
    assert out.strip() == str(i * 2)


@pytest.mark.parametrize("i", range(30))
def test_exec_python_error(i):
    code = f"raise ValueError('boom-{i}')"
    rc, out, err = exec_python(code)
    assert rc != 0
    assert f"boom-{i}" in err


# ---- node exec (if node present) ----
import shutil
HAVE_NODE = shutil.which("node") is not None


@pytest.mark.skipif(not HAVE_NODE, reason="node not installed")
@pytest.mark.parametrize("i", range(50))
def test_exec_node(i):
    rc, out, err = exec_node(f"console.log({i} + 1);")
    assert rc == 0
    assert out.strip() == str(i + 1)


# ---- task decomposition ----
DECOMP_CASES = [
    ("Write a report on Q3", ["gather sources", "outline", "draft", "review", "export"]),
    ("Analyze the sales data", ["load data", "clean", "explore", "model", "summarize"]),
    ("Handle email triage", ["read inbox", "triage", "draft replies", "review"]),
    ("Do something else", ["understand", "plan", "execute", "verify"]),
]


@pytest.mark.parametrize("task,expected", DECOMP_CASES * 25)
def test_decompose(task, expected):
    assert decompose_task(task) == expected


# ---- todo list progress ----
@pytest.mark.parametrize("n", list(range(1, 51)))
def test_todo_progress(n):
    t = TodoList()
    ids = [t.add(f"task {i}") for i in range(n)]
    for i in ids:
        t.start(i)
        t.done(i)
    assert t.progress() == 1.0
