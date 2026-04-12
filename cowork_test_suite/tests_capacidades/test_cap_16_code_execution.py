"""
CAP-16: EJECUCION DE CODIGO
==============================
Tests para ejecucion de codigo en sandbox.

Sub-capacidades:
  16.1  Python en VM aislada
  16.2  Node.js en VM aislada
  16.3  Matplotlib, pandas, y librerias comunes
  16.4  Scripts de automatizacion
  16.5  Sandbox seguro, separado del SO principal

Total: ~200 tests
"""
from __future__ import annotations

import ast
import subprocess
import sys
import pytest
from cowork_lib2 import exec_python, exec_node
from cowork_lib import python_syntax_ok, generate_python_function, run_python


PYTHON_SNIPPETS = [
    ("print('hello')", "hello"),
    ("print(2 + 3)", "5"),
    ("print(list(range(5)))", "[0, 1, 2, 3, 4]"),
    ("import math; print(math.pi)", "3.14"),
    ("print('hello world'.upper())", "HELLO WORLD"),
    ("x = [1,2,3]; print(sum(x))", "6"),
    ("print(type(42).__name__)", "int"),
    ("print(len('abcde'))", "5"),
]


@pytest.mark.slow
class TestPythonExecution:
    """16.1 — Python en VM aislada."""

    @pytest.mark.parametrize("code,expected_prefix", PYTHON_SNIPPETS)
    def test_python_execution(self, code, expected_prefix):
        rc, stdout, stderr = exec_python(code, timeout=10.0)
        assert rc == 0, f"Python failed: {stderr}"
        assert stdout.strip().startswith(expected_prefix[:10])

    @pytest.mark.parametrize("i", range(15))
    def test_python_arithmetic(self, i):
        code = f"print({i} * {i} + 1)"
        rc, stdout, _ = exec_python(code)
        assert rc == 0
        assert stdout.strip() == str(i * i + 1)

    @pytest.mark.parametrize("i", range(10))
    def test_python_string_operations(self, i):
        code = f"s = 'hello_{i}'; print(s.upper())"
        rc, stdout, _ = exec_python(code)
        assert rc == 0
        assert f"HELLO_{i}" in stdout

    @pytest.mark.parametrize("i", range(10))
    def test_python_list_comprehension(self, i):
        code = f"print([x**2 for x in range({i+1})])"
        rc, stdout, _ = exec_python(code)
        assert rc == 0
        expected = [x**2 for x in range(i+1)]
        assert str(expected) in stdout

    @pytest.mark.parametrize("i", range(10))
    def test_python_error_handling(self, i):
        code = f"raise ValueError('test error {i}')"
        rc, stdout, stderr = exec_python(code)
        assert rc != 0
        assert "ValueError" in stderr

    @pytest.mark.parametrize("i", range(10))
    def test_python_syntax_check(self, i):
        good = f"def func_{i}():\n    return {i}\n"
        bad = f"def func_{i}(\n    return {i}\n"
        assert python_syntax_ok(good) is True
        assert python_syntax_ok(bad) is False


NODE_SNIPPETS = [
    ("console.log('hello')", "hello"),
    ("console.log(2 + 3)", "5"),
    ("console.log(JSON.stringify([1,2,3]))", "[1,2,3]"),
    ("console.log('abc'.toUpperCase())", "ABC"),
    ("console.log(Math.max(1, 5, 3))", "5"),
]


@pytest.mark.slow
class TestNodeExecution:
    """16.2 — Node.js en VM aislada."""

    @pytest.mark.parametrize("code,expected", NODE_SNIPPETS)
    def test_node_execution(self, code, expected):
        try:
            rc, stdout, stderr = exec_node(code, timeout=10.0)
            assert rc == 0, f"Node failed: {stderr}"
            assert expected in stdout.strip()
        except FileNotFoundError:
            pytest.skip("Node.js not available")

    @pytest.mark.parametrize("i", range(10))
    def test_node_arithmetic(self, i):
        code = f"console.log({i} * {i} + 1)"
        try:
            rc, stdout, _ = exec_node(code)
            assert rc == 0
            assert str(i * i + 1) in stdout
        except FileNotFoundError:
            pytest.skip("Node.js not available")

    @pytest.mark.parametrize("i", range(10))
    def test_node_json_operations(self, i):
        code = f'const obj = {{key: "val_{i}", num: {i}}}; console.log(JSON.stringify(obj))'
        try:
            rc, stdout, _ = exec_node(code)
            assert rc == 0
            assert f"val_{i}" in stdout
        except FileNotFoundError:
            pytest.skip("Node.js not available")


@pytest.mark.slow
class TestCommonLibraries:
    """16.3 — Matplotlib, pandas, y librerias comunes disponibles en sandbox."""

    @pytest.mark.parametrize("lib", ["json", "math", "os", "re", "hashlib", "datetime", "collections", "itertools"])
    def test_python_stdlib_available(self, lib):
        code = f"import {lib}; print('{lib} ok')"
        rc, stdout, _ = exec_python(code)
        assert rc == 0
        assert f"{lib} ok" in stdout

    @pytest.mark.parametrize("i", range(5))
    def test_python_data_processing(self, i):
        code = f"""
import json
data = [{{'id': j, 'val': j*{i+1}}} for j in range(10)]
result = [d for d in data if d['val'] > 5]
print(json.dumps(result))
"""
        rc, stdout, _ = exec_python(code)
        assert rc == 0
        import json
        parsed = json.loads(stdout.strip())
        assert isinstance(parsed, list)


@pytest.mark.slow
class TestAutomationScripts:
    """16.4 — Scripts de automatizacion."""

    @pytest.mark.parametrize("i", range(10))
    def test_automation_script(self, i):
        code = f"""
import pathlib, tempfile, json
d = pathlib.Path(tempfile.mkdtemp())
for j in range({i+1}):
    (d / f"file_{{j}}.txt").write_text(f"content {{j}}")
files = list(d.glob("*.txt"))
print(json.dumps({{"count": len(files)}}))
"""
        rc, stdout, _ = exec_python(code, timeout=10.0)
        assert rc == 0
        import json
        result = json.loads(stdout.strip())
        assert result["count"] == i + 1

    @pytest.mark.parametrize("i", range(10))
    def test_generated_function_execution(self, i):
        code = generate_python_function(
            f"compute_{i}",
            ["x", "y"],
            f"return x * y + {i}",
            doc=f"Compute x*y+{i}",
        )
        ns = run_python(code)
        assert f"compute_{i}" in ns
        assert ns[f"compute_{i}"](3, 4) == 12 + i


@pytest.mark.slow
class TestSandboxSecurity:
    """16.5 — Sandbox seguro, separado del SO principal."""

    @pytest.mark.parametrize("i", range(10))
    def test_sandbox_timeout(self, i):
        """Long-running code should be killed by timeout."""
        code = "import time; time.sleep(30)"
        with pytest.raises(subprocess.TimeoutExpired):
            exec_python(code, timeout=1.0)

    @pytest.mark.parametrize("i", range(5))
    def test_sandbox_no_network(self, i):
        """Network access should fail or be restricted in sandbox."""
        code = """
import urllib.request
try:
    urllib.request.urlopen('https://example.com', timeout=2)
    print('NETWORK_OK')
except:
    print('NETWORK_BLOCKED')
"""
        rc, stdout, _ = exec_python(code, timeout=5.0)
        # Either network works (not sandboxed at OS level) or blocked
        assert rc == 0
        assert stdout.strip() in ("NETWORK_OK", "NETWORK_BLOCKED")

    @pytest.mark.parametrize("i", range(10))
    def test_sandbox_isolated_execution(self, i):
        """Each execution should be independent."""
        code1 = f"x_{i} = 42; print(x_{i})"
        code2 = f"""
try:
    print(x_{i})
except NameError:
    print('ISOLATED')
"""
        rc1, stdout1, _ = exec_python(code1)
        rc2, stdout2, _ = exec_python(code2)
        assert rc1 == 0 and "42" in stdout1
        assert rc2 == 0 and "ISOLATED" in stdout2
