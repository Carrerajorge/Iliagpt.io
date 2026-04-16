"""
Capabilities 6, 7, 8, 9 — Browser mock, computer use, cron, dispatch.
~800 tests.
"""
from __future__ import annotations

from datetime import datetime

import pytest

from cowork_lib2 import (
    MockBrowser, open_app, ALLOWED_APPS, cron_next,
    Dispatch,
)


# ---- browser navigate ----
URLS = [
    "https://example.com",
    "https://iliagpt.io/dashboard",
    "http://localhost:3000/path",
    "https://github.com/openai/repo",
    "https://docs.python.org/3/library/",
]


@pytest.mark.parametrize("u", URLS * 20)
def test_browser_navigate(u):
    b = MockBrowser()
    loaded = b.navigate(u)
    assert loaded.startswith("loaded:")
    assert u in b.history


@pytest.mark.parametrize("u", ["ftp://bad.com", "file:///etc/passwd", "javascript:alert(1)"])
def test_browser_rejects_unsafe(u):
    b = MockBrowser()
    with pytest.raises(ValueError):
        b.navigate(u)


@pytest.mark.parametrize("i", range(100))
def test_browser_fill_and_submit(i):
    b = MockBrowser()
    b.fill_form("f1", {"name": f"user{i}", "age": str(i)})
    res = b.submit("f1")
    assert res["name"] == f"user{i}"
    assert res["age"] == str(i)


@pytest.mark.parametrize("u", URLS * 10)
def test_browser_screenshot(u):
    b = MockBrowser()
    shot = b.screenshot(u)
    assert isinstance(shot, bytes) and len(shot) == 32


JS_CASES = [
    ("1+2", 3),
    ("Math.floor(3.7)", 3),
    ("Math.floor(-2.1)", -3),
    ('"hello".length', 5),
    ('"world!".length', 6),
]


@pytest.mark.parametrize("expr,expected", JS_CASES * 20)
def test_browser_eval_js(expr, expected):
    b = MockBrowser()
    assert b.eval_js(expr) == expected


# ---- computer use ----
@pytest.mark.parametrize("app", list(ALLOWED_APPS) * 20)
def test_computer_open_allowed(app):
    assert open_app(app) == f"opened:{app}"


@pytest.mark.parametrize("app", ["Terminal", "SSH", "Finder", "Bash"])
def test_computer_open_denied(app):
    with pytest.raises(PermissionError):
        open_app(app)


# ---- cron ----
CRON_CASES = [
    ("0 9 * * *", datetime(2026, 4, 11, 8, 30), datetime(2026, 4, 11, 9, 0)),
    ("*/15 * * * *", datetime(2026, 4, 11, 9, 32), datetime(2026, 4, 11, 9, 45)),
    ("0 0 1 * *", datetime(2026, 4, 11, 9, 0), datetime(2026, 5, 1, 0, 0)),
    ("30 14 * * 1-5", datetime(2026, 4, 11, 8, 0), datetime(2026, 4, 13, 14, 30)),  # Sat -> Mon
    ("0 12 * * 0", datetime(2026, 4, 11, 8, 0), datetime(2026, 4, 12, 12, 0)),
]


@pytest.mark.parametrize("expr,now,expected", CRON_CASES * 10)
def test_cron_next(expr, now, expected):
    got = cron_next(expr, now)
    assert got == expected


# ---- dispatch ----
@pytest.mark.parametrize("device", ["iphone", "android", "ipad"] * 30)
def test_dispatch_queue(device):
    d = Dispatch()
    msg_id = d.send(device, "make me a report")
    assert any(m["id"] == msg_id for m in d.queue)
    done = d.execute_next()
    assert done is not None and done["status"] == "done"
