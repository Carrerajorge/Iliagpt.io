"""
CAP-10: AUTOMATIZACION DE NAVEGADOR
=====================================
Tests para capacidades de browser automation.

Sub-capacidades:
  10.1  Navegar sitios web
  10.2  Hacer clic en elementos, llenar formularios
  10.3  Tomar screenshots de paginas
  10.4  Extraer contenido de paginas web
  10.5  Ejecutar JavaScript en contexto de pagina
  10.6  Investigacion web directa

Total: ~300 tests
"""
from __future__ import annotations

import pytest
from cowork_lib2 import MockBrowser


@pytest.fixture
def browser():
    return MockBrowser()


VALID_URLS = [
    "https://example.com",
    "https://iliagpt.io/dashboard",
    "http://localhost:3000/api/health",
    "https://github.com/anthropics/claude-code",
    "https://docs.python.org/3/library/json.html",
    "https://en.wikipedia.org/wiki/Artificial_intelligence",
    "https://api.github.com/repos/owner/repo",
    "https://app.slack.com/client/T123/C456",
    "https://www.google.com/search?q=test",
    "https://mail.google.com/mail/inbox",
]

UNSAFE_URLS = [
    "ftp://bad.com/file",
    "file:///etc/passwd",
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "ftp://internal.corp/secrets",
]


# ============================================================================
# 10.1 — Navegacion web
# ============================================================================

@pytest.mark.automation
class TestWebNavigation:
    """10.1 — Navigate to URLs, track history, and reject unsafe schemes."""

    @pytest.mark.parametrize("url", VALID_URLS)
    def test_navigate_valid_url(self, browser, url):
        result = browser.navigate(url)
        assert result.startswith("loaded:")
        assert url in browser.history

    @pytest.mark.parametrize("url", VALID_URLS * 3)
    def test_navigate_history_tracking(self, browser, url):
        browser.navigate(url)
        assert len(browser.history) >= 1
        assert browser.history[-1] == url

    @pytest.mark.parametrize("url", UNSAFE_URLS)
    def test_navigate_rejects_unsafe(self, browser, url):
        with pytest.raises(ValueError):
            browser.navigate(url)

    @pytest.mark.parametrize("i", range(20))
    def test_navigate_multiple_pages(self, browser, i):
        urls = [f"https://site{j}.com/page{i}" for j in range(5)]
        for url in urls:
            browser.navigate(url)
        assert len(browser.history) == 5

    @pytest.mark.parametrize("i", range(10))
    def test_navigate_returns_domain(self, browser, i):
        url = f"https://domain{i}.com/path/to/page"
        result = browser.navigate(url)
        assert f"domain{i}.com" in result


# ============================================================================
# 10.2 — Click y formularios
# ============================================================================

@pytest.mark.automation
class TestFormInteraction:
    """10.2 — Fill forms, submit data, overwrite fields, and handle multiple forms."""

    @pytest.mark.parametrize("i", range(20))
    def test_fill_form(self, browser, i):
        fields = {"name": f"User_{i}", "email": f"user{i}@test.com", "age": str(20 + i)}
        browser.fill_form(f"form_{i}", fields)
        submitted = browser.submit(f"form_{i}")
        assert submitted["name"] == f"User_{i}"
        assert submitted["email"] == f"user{i}@test.com"

    @pytest.mark.parametrize("n_fields", [1, 3, 5, 10])
    def test_form_field_count(self, browser, n_fields):
        fields = {f"field_{j}": f"value_{j}" for j in range(n_fields)}
        browser.fill_form("test_form", fields)
        result = browser.submit("test_form")
        assert len(result) == n_fields

    @pytest.mark.parametrize("i", range(10))
    def test_form_overwrite(self, browser, i):
        browser.fill_form("f1", {"name": "original"})
        browser.fill_form("f1", {"name": f"updated_{i}"})
        result = browser.submit("f1")
        assert result["name"] == f"updated_{i}"

    @pytest.mark.parametrize("i", range(10))
    def test_multiple_forms(self, browser, i):
        browser.fill_form("login", {"user": f"admin_{i}", "pass": "secret"})
        browser.fill_form("search", {"query": f"search term {i}"})
        assert browser.submit("login")["user"] == f"admin_{i}"
        assert browser.submit("search")["query"] == f"search term {i}"

    @pytest.mark.parametrize("i", range(10))
    def test_submit_empty_form(self, browser, i):
        result = browser.submit(f"nonexistent_{i}")
        assert result == {}


# ============================================================================
# 10.3 — Screenshots
# ============================================================================

@pytest.mark.automation
class TestScreenshots:
    """10.3 — Take page screenshots: deterministic output and uniqueness per URL."""

    @pytest.mark.parametrize("url", VALID_URLS)
    def test_screenshot_returns_bytes(self, browser, url):
        shot = browser.screenshot(url)
        assert isinstance(shot, bytes)
        assert len(shot) == 32  # SHA-256 digest

    @pytest.mark.parametrize("i", range(20))
    def test_screenshot_deterministic(self, browser, i):
        url = f"https://page{i}.com"
        shot1 = browser.screenshot(url)
        shot2 = browser.screenshot(url)
        assert shot1 == shot2  # same URL = same screenshot

    @pytest.mark.parametrize("i", range(10))
    def test_screenshot_different_pages(self, browser, i):
        shots = [browser.screenshot(f"https://page{j}.com") for j in range(5)]
        # All should be different
        assert len(set(shots)) == 5


# ============================================================================
# 10.4 — Extraccion de contenido
# ============================================================================

@pytest.mark.automation
class TestContentExtraction:
    """10.4 — Extract content from web pages via navigation."""

    @pytest.mark.parametrize("url", VALID_URLS)
    def test_navigate_extracts_path(self, browser, url):
        result = browser.navigate(url)
        assert "loaded:" in result

    @pytest.mark.parametrize("i", range(15))
    def test_content_from_navigation(self, browser, i):
        url = f"https://content{i}.com/article/{i}"
        result = browser.navigate(url)
        assert f"content{i}.com" in result
        assert f"/article/{i}" in result


# ============================================================================
# 10.5 — Ejecucion de JavaScript
# ============================================================================

@pytest.mark.automation
class TestJavaScriptExecution:
    """10.5 — Evaluate JavaScript expressions in page context."""

    JS_EXPRESSIONS = [
        ("1+2", 3),
        ("Math.floor(3.7)", 3),
        ("Math.floor(-2.1)", -3),
        ("Math.floor(0.9)", 0),
        ("Math.floor(100.1)", 100),
        ('"hello".length', 5),
        ('"world!".length', 6),
        ('"test".length', 4),
        ('"".length', 0),
        ('"abcdefghij".length', 10),
    ]

    @pytest.mark.parametrize("expr,expected", JS_EXPRESSIONS)
    def test_eval_js(self, browser, expr, expected):
        result = browser.eval_js(expr)
        assert result == expected

    @pytest.mark.parametrize("i", range(10))
    def test_eval_js_math_floor(self, browser, i):
        val = i + 0.7
        result = browser.eval_js(f"Math.floor({val})")
        assert result == i

    @pytest.mark.parametrize("i", range(10))
    def test_eval_js_string_length(self, browser, i):
        s = "x" * (i + 1)
        result = browser.eval_js(f'"{s}".length')
        assert result == i + 1

    @pytest.mark.parametrize("expr", ["unknown()", "foo.bar", "let x = 1"])
    def test_eval_js_unsupported(self, browser, expr):
        with pytest.raises(NotImplementedError):
            browser.eval_js(expr)


# ============================================================================
# 10.6 — Investigacion web
# ============================================================================

@pytest.mark.automation
class TestWebResearch:
    """10.6 — Multi-step web research flows: navigate, extract, and compile."""

    @pytest.mark.parametrize("i", range(15))
    def test_web_research_flow(self, browser, i):
        """Simulate a research flow: navigate, extract, compile."""
        urls = [f"https://source{j}.com/article/{i}" for j in range(3)]
        results = []
        for url in urls:
            nav_result = browser.navigate(url)
            results.append({"url": url, "content": nav_result})
        assert len(results) == 3
        assert all("loaded:" in r["content"] for r in results)
        assert len(browser.history) == 3

    @pytest.mark.parametrize("i", range(10))
    def test_research_multi_step(self, browser, i):
        """Multi-step: search -> navigate results -> extract."""
        browser.navigate(f"https://search.com/q=topic+{i}")
        browser.navigate(f"https://result1.com/article/{i}")
        browser.navigate(f"https://result2.com/paper/{i}")
        assert len(browser.history) == 3
        screenshots = [browser.screenshot(url) for url in browser.history]
        assert len(set(screenshots)) == 3  # all different
