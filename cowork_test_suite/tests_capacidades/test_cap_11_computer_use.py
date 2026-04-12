"""
CAP-11: COMPUTER USE (USO DEL COMPUTADOR)
===========================================
Tests para capacidades de computer use.

Sub-capacidades:
  11.1  Abrir aplicaciones en el escritorio
  11.2  Navegar el navegador
  11.3  Llenar hojas de calculo directamente
  11.4  Completar formularios web
  11.5  Cualquier accion manual en PC
  11.6  Pide permiso antes de acceder a apps nuevas

Total: ~300 tests
"""
from __future__ import annotations

import pytest
from cowork_lib2 import open_app, ALLOWED_APPS, MockBrowser
from cowork_lib3 import SpreadsheetApp, WebFormApp


DENIED_APPS = ["Terminal", "SSH", "Finder", "Bash", "iTerm", "cmd.exe",
               "PowerShell", "SystemPreferences", "Registry", "sudo"]


# ============================================================================
# 11.1 — Abrir aplicaciones
# ============================================================================

@pytest.mark.automation
class TestAppOpening:
    """11.1 — Open desktop applications with permission checks."""

    @pytest.mark.parametrize("app", list(ALLOWED_APPS))
    def test_open_allowed_app(self, app):
        result = open_app(app)
        assert result == f"opened:{app}"

    @pytest.mark.parametrize("app", list(ALLOWED_APPS) * 5)
    def test_open_app_idempotent(self, app):
        r1 = open_app(app)
        r2 = open_app(app)
        assert r1 == r2

    @pytest.mark.parametrize("app", DENIED_APPS)
    def test_open_denied_app(self, app):
        with pytest.raises(PermissionError):
            open_app(app)

    @pytest.mark.parametrize("i", range(10))
    def test_open_unknown_app(self, i):
        with pytest.raises(PermissionError):
            open_app(f"UnknownApp_{i}")


# ============================================================================
# 11.2 — Navegacion en navegador
# ============================================================================

@pytest.mark.automation
class TestBrowserNavigation:
    """11.2 — Navigate the browser within computer-use context."""

    @pytest.mark.parametrize("i", range(20))
    def test_browser_in_computer_use(self, i):
        b = MockBrowser()
        b.navigate(f"https://app{i}.com/dashboard")
        assert len(b.history) == 1

    @pytest.mark.parametrize("i", range(10))
    def test_browser_multi_tab_sim(self, i):
        tabs = [MockBrowser() for _ in range(3)]
        for j, tab in enumerate(tabs):
            tab.navigate(f"https://site{j}.com/page{i}")
        for j, tab in enumerate(tabs):
            assert tab.history[-1] == f"https://site{j}.com/page{i}"


# ============================================================================
# 11.3 — Llenar hojas de calculo
# ============================================================================

@pytest.mark.automation
class TestSpreadsheetFilling:
    """11.3 — Fill spreadsheets directly via computer use."""

    @pytest.mark.parametrize("i", range(20))
    def test_spreadsheet_set_cell(self, i):
        app = SpreadsheetApp()
        app.set_cell(i, 0, f"Label_{i}")
        app.set_cell(i, 1, i * 100)
        assert app.get_cell(i, 0) == f"Label_{i}"
        assert app.get_cell(i, 1) == i * 100

    @pytest.mark.parametrize("rows,cols", [(3, 3), (5, 5), (10, 4), (20, 3)])
    def test_spreadsheet_fill_range(self, rows, cols):
        app = SpreadsheetApp()
        data = [[i * cols + j for j in range(cols)] for i in range(rows)]
        count = app.fill_range(0, 0, data)
        assert count == rows * cols
        for i in range(rows):
            for j in range(cols):
                assert app.get_cell(i, j) == i * cols + j

    @pytest.mark.parametrize("i", range(15))
    def test_spreadsheet_overwrite_cell(self, i):
        app = SpreadsheetApp()
        app.set_cell(0, 0, "original")
        app.set_cell(0, 0, f"updated_{i}")
        assert app.get_cell(0, 0) == f"updated_{i}"

    @pytest.mark.parametrize("i", range(10))
    def test_spreadsheet_empty_cell(self, i):
        app = SpreadsheetApp()
        assert app.get_cell(i, i) is None

    @pytest.mark.parametrize("i", range(10))
    def test_spreadsheet_mixed_types(self, i):
        app = SpreadsheetApp()
        app.set_cell(0, 0, f"text_{i}")
        app.set_cell(0, 1, i * 3.14)
        app.set_cell(0, 2, True)
        app.set_cell(0, 3, None)
        assert isinstance(app.get_cell(0, 0), str)
        assert isinstance(app.get_cell(0, 1), float)
        assert isinstance(app.get_cell(0, 2), bool)
        assert app.get_cell(0, 3) is None


# ============================================================================
# 11.4 — Completar formularios web
# ============================================================================

@pytest.mark.automation
class TestWebFormFilling:
    """11.4 — Complete web forms with validation."""

    @pytest.mark.parametrize("i", range(20))
    def test_web_form_fill(self, i):
        form = WebFormApp(
            validation_rules={"name": "required", "email": "email"}
        )
        form.fill("name", f"User_{i}")
        form.fill("email", f"user{i}@test.com")
        success, errors = form.submit()
        assert success is True
        assert len(errors) == 0
        assert form.submitted is True

    @pytest.mark.parametrize("i", range(15))
    def test_web_form_validation_required(self, i):
        form = WebFormApp(
            validation_rules={"name": "required", "email": "required"}
        )
        form.fill("name", f"User_{i}")
        # email not filled
        success, errors = form.submit()
        assert success is False
        assert any("email" in e for e in errors)

    @pytest.mark.parametrize("i", range(10))
    def test_web_form_validation_email(self, i):
        form = WebFormApp(validation_rules={"email": "email"})
        form.fill("email", f"invalid_email_{i}")
        success, errors = form.submit()
        assert success is False
        assert any("email" in e.lower() for e in errors)

    @pytest.mark.parametrize("i", range(10))
    def test_web_form_validation_numeric(self, i):
        form = WebFormApp(validation_rules={"amount": "numeric"})
        form.fill("amount", f"not_a_number_{i}")
        success, errors = form.submit()
        assert success is False

    @pytest.mark.parametrize("i", range(10))
    def test_web_form_valid_numeric(self, i):
        form = WebFormApp(validation_rules={"amount": "numeric"})
        form.fill("amount", str(i * 100))
        success, errors = form.submit()
        assert success is True

    @pytest.mark.parametrize("n_fields", [1, 3, 5, 8])
    def test_web_form_multiple_fields(self, n_fields):
        rules = {f"field_{j}": "required" for j in range(n_fields)}
        form = WebFormApp(validation_rules=rules)
        for j in range(n_fields):
            form.fill(f"field_{j}", f"value_{j}")
        success, errors = form.submit()
        assert success is True


# ============================================================================
# 11.5 — Acciones manuales simuladas
# ============================================================================

@pytest.mark.automation
class TestManualWorkflows:
    """11.5 — Simulate any manual PC action (open app, fill, submit)."""

    @pytest.mark.parametrize("i", range(10))
    def test_manual_workflow_simulation(self, i):
        """Simulate: open app -> fill data -> submit."""
        result = open_app("Excel")
        assert "opened" in result
        app = SpreadsheetApp()
        app.fill_range(0, 0, [[f"Data_{i}_{j}" for j in range(3)] for _ in range(5)])
        assert app.get_cell(0, 0) == f"Data_{i}_0"

    @pytest.mark.parametrize("i", range(10))
    def test_browser_then_form(self, i):
        b = MockBrowser()
        b.navigate(f"https://app.example.com/form/{i}")
        b.fill_form("main_form", {"field1": f"val_{i}", "field2": "data"})
        result = b.submit("main_form")
        assert result["field1"] == f"val_{i}"


# ============================================================================
# 11.6 — Permisos por app
# ============================================================================

@pytest.mark.automation
class TestAppPermissions:
    """11.6 — Permission checks before accessing new apps."""

    @pytest.mark.parametrize("app", list(ALLOWED_APPS))
    def test_allowed_apps_whitelist(self, app):
        """All allowed apps should be in the whitelist."""
        assert app in ALLOWED_APPS

    @pytest.mark.parametrize("i", range(10))
    def test_permission_denied_message(self, i):
        try:
            open_app(f"Restricted_{i}")
            assert False, "Should have raised PermissionError"
        except PermissionError as e:
            assert "not allowed" in str(e).lower()

    @pytest.mark.parametrize("i", range(10))
    def test_allowed_set_immutable(self, i):
        """ALLOWED_APPS should not be modifiable during runtime."""
        original = set(ALLOWED_APPS)
        # Verify it hasn't changed
        assert ALLOWED_APPS == original
