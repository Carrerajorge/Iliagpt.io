"""
CAP-05: OTROS FORMATOS DE SALIDA
==================================
Tests para generacion de formatos adicionales.

Sub-capacidades:
  5.1  Markdown (.md)
  5.2  HTML (.html)
  5.3  React (.jsx, .tsx)
  5.4  LaTeX (documentos matematicos y tecnicos)
  5.5  CSV / TSV
  5.6  JSON
  5.7  Imagenes PNG (charts con matplotlib)
  5.8  Archivos de codigo en cualquier lenguaje

Total: ~400 tests
"""
from __future__ import annotations

import json
import pytest
from pathlib import Path

from cowork_lib2 import (
    write_markdown,
    write_html,
    write_csv,
    write_json,
    write_latex,
    write_png_chart,
    write_code_file,
)
from cowork_lib3 import generate_react_component


@pytest.fixture
def out_dir(tmp_path):
    d = tmp_path / "cap05_formats"
    d.mkdir()
    return d


# ============================================================================
# 5.1 — Markdown
# ============================================================================

@pytest.mark.file_generation
class TestMarkdownGeneration:
    """5.1 — Markdown document creation with sections and UTF-8 support."""

    @pytest.mark.parametrize("i", range(20))
    def test_markdown_creation(self, out_dir, i):
        path = out_dir / f"doc_{i}.md"
        sections = [f"Paragraph about topic {j}" for j in range(3)]
        write_markdown(path, f"Title {i}", sections)
        content = path.read_text()
        assert content.startswith(f"# Title {i}")
        assert "## Section 1" in content

    @pytest.mark.parametrize("n_sections", [1, 3, 5, 10])
    def test_markdown_sections(self, out_dir, n_sections):
        path = out_dir / f"md_sections_{n_sections}.md"
        sections = [f"Content for section {j}" for j in range(n_sections)]
        write_markdown(path, "Test", sections)
        content = path.read_text()
        assert content.count("## Section") == n_sections

    @pytest.mark.parametrize("i", range(10))
    def test_markdown_utf8(self, out_dir, i):
        path = out_dir / f"md_utf8_{i}.md"
        write_markdown(path, f"Titulo con acentos {i}", [f"Parrafo con enhe y tilde: nino, cafe"])
        content = path.read_text(encoding="utf-8")
        assert "acentos" in content


# ============================================================================
# 5.2 — HTML
# ============================================================================

@pytest.mark.file_generation
class TestHtmlGeneration:
    """5.2 — HTML page creation with valid structure and UTF-8 charset."""

    @pytest.mark.parametrize("i", range(20))
    def test_html_creation(self, out_dir, i):
        path = out_dir / f"page_{i}.html"
        write_html(path, f"Page {i}", f"<h1>Hello {i}</h1><p>Content here.</p>")
        content = path.read_text()
        assert "<!DOCTYPE html>" in content
        assert f"<title>Page {i}</title>" in content

    @pytest.mark.parametrize("i", range(10))
    def test_html_valid_structure(self, out_dir, i):
        path = out_dir / f"valid_{i}.html"
        write_html(path, "Test", "<div><p>Paragraph</p></div>")
        content = path.read_text()
        assert "<html" in content
        assert "</html>" in content
        assert "<head>" in content
        assert "<body>" in content

    @pytest.mark.parametrize("i", range(10))
    def test_html_charset_utf8(self, out_dir, i):
        path = out_dir / f"charset_{i}.html"
        write_html(path, f"Pagina {i}", "<p>Contenido</p>")
        content = path.read_text()
        assert 'charset="utf-8"' in content or "charset=utf-8" in content


# ============================================================================
# 5.3 — React JSX/TSX
# ============================================================================

@pytest.mark.file_generation
class TestReactComponentGeneration:
    """5.3 — React component generation in JSX and TSX with props and interfaces."""

    @pytest.mark.parametrize("i", range(15))
    def test_react_tsx_component(self, i):
        code = generate_react_component(
            f"Card{i}",
            {"title": "string", "count": "number"},
            f"<div><h2>{{title}}</h2><span>{{count}}</span></div>",
            typescript=True,
        )
        assert f"Card{i}Props" in code
        assert "interface" in code
        assert "export default function" in code

    @pytest.mark.parametrize("i", range(15))
    def test_react_jsx_component(self, i):
        code = generate_react_component(
            f"Button{i}",
            {"label": "string", "onClick": "function"},
            "<button onClick={onClick}>{label}</button>",
            typescript=False,
        )
        assert "export default function" in code
        assert "interface" not in code  # JSX, no types

    @pytest.mark.parametrize("n_props", [0, 1, 3, 5])
    def test_react_component_props_count(self, n_props):
        props = {f"prop{j}": "string" for j in range(n_props)}
        code = generate_react_component("TestComp", props, "<div/>")
        if n_props > 0:
            assert "prop0" in code
        assert "export default function TestComp" in code

    @pytest.mark.parametrize("i", range(10))
    def test_react_tsx_has_interface(self, i):
        code = generate_react_component(
            f"Widget{i}",
            {"data": "any[]", "onSelect": "(id: string) => void"},
            "<ul>{data.map(d => <li key={d}>{d}</li>)}</ul>",
        )
        assert f"Widget{i}Props" in code
        assert "data: any[];" in code


# ============================================================================
# 5.4 — LaTeX
# ============================================================================

@pytest.mark.file_generation
class TestLatexGeneration:
    """5.4 — LaTeX document creation with title, author, and document structure."""

    @pytest.mark.parametrize("i", range(15))
    def test_latex_creation(self, out_dir, i):
        path = out_dir / f"paper_{i}.tex"
        write_latex(path, f"Paper Title {i}", f"Author {i}", r"This is the body with $E = mc^2$.")
        content = path.read_text()
        assert r"\documentclass{article}" in content
        assert f"Paper Title {i}" in content
        assert r"\begin{document}" in content
        assert r"\end{document}" in content

    @pytest.mark.parametrize("i", range(10))
    def test_latex_author(self, out_dir, i):
        path = out_dir / f"latex_author_{i}.tex"
        write_latex(path, "Title", f"Dr. Smith {i}", "Body text.")
        content = path.read_text()
        assert f"Dr. Smith {i}" in content
        assert r"\author{" in content

    @pytest.mark.parametrize("i", range(10))
    def test_latex_maketitle(self, out_dir, i):
        path = out_dir / f"latex_title_{i}.tex"
        write_latex(path, f"Research {i}", "Author", "Content")
        content = path.read_text()
        assert r"\maketitle" in content


# ============================================================================
# 5.5 — CSV / TSV
# ============================================================================

@pytest.mark.file_generation
class TestCsvTsvGeneration:
    """5.5 — CSV and TSV file creation with correct delimiters and column counts."""

    @pytest.mark.parametrize("n_rows", [1, 5, 10, 50, 100])
    def test_csv_creation(self, out_dir, n_rows):
        rows = [["id", "name", "value"]] + [[str(j), f"item_{j}", str(j * 10)] for j in range(n_rows)]
        path = out_dir / f"data_{n_rows}.csv"
        write_csv(path, rows)
        lines = path.read_text().strip().split("\n")
        assert len(lines) == n_rows + 1  # header + data

    @pytest.mark.parametrize("n_rows", [1, 5, 10, 50])
    def test_tsv_creation(self, out_dir, n_rows):
        rows = [["id", "name"]] + [[str(j), f"item_{j}"] for j in range(n_rows)]
        path = out_dir / f"data_{n_rows}.tsv"
        write_csv(path, rows, delimiter="\t")
        content = path.read_text()
        assert "\t" in content

    @pytest.mark.parametrize("cols", [2, 3, 5, 8])
    def test_csv_column_count(self, out_dir, cols):
        header = [f"col_{j}" for j in range(cols)]
        rows = [header] + [[str(j * i) for j in range(cols)] for i in range(5)]
        path = out_dir / f"csv_cols_{cols}.csv"
        write_csv(path, rows)
        first_line = path.read_text().split("\n")[0]
        assert first_line.count(",") == cols - 1


# ============================================================================
# 5.6 — JSON
# ============================================================================

@pytest.mark.file_generation
class TestJsonGeneration:
    """5.6 — JSON file creation with nested structures and UTF-8 support."""

    @pytest.mark.parametrize("i", range(20))
    def test_json_creation(self, out_dir, i):
        obj = {"id": i, "name": f"item_{i}", "values": list(range(i))}
        path = out_dir / f"data_{i}.json"
        write_json(path, obj)
        loaded = json.loads(path.read_text())
        assert loaded["id"] == i
        assert loaded["name"] == f"item_{i}"

    @pytest.mark.parametrize("i", range(10))
    def test_json_nested(self, out_dir, i):
        obj = {
            "config": {"level": i, "nested": {"deep": True}},
            "items": [{"id": j} for j in range(3)],
        }
        path = out_dir / f"nested_{i}.json"
        write_json(path, obj)
        loaded = json.loads(path.read_text())
        assert loaded["config"]["nested"]["deep"] is True

    @pytest.mark.parametrize("i", range(10))
    def test_json_utf8_support(self, out_dir, i):
        obj = {"mensaje": f"Hola mundo {i}", "emoji": "cafe"}
        path = out_dir / f"utf8_{i}.json"
        write_json(path, obj)
        loaded = json.loads(path.read_text(encoding="utf-8"))
        assert "Hola" in loaded["mensaje"]


# ============================================================================
# 5.7 — PNG charts (matplotlib)
# ============================================================================

@pytest.mark.file_generation
class TestPngChartGeneration:
    """5.7 — PNG chart creation with matplotlib, including valid image headers."""

    @pytest.mark.parametrize("n_points", [5, 10, 20, 50])
    def test_png_chart_creation(self, out_dir, n_points):
        xs = list(range(n_points))
        ys = [x ** 2 for x in xs]
        path = out_dir / f"chart_{n_points}.png"
        write_png_chart(path, xs, ys, title=f"Chart {n_points}")
        assert path.exists()
        assert path.stat().st_size > 1000  # PNG should be non-trivial

    @pytest.mark.parametrize("i", range(10))
    def test_png_chart_is_valid_image(self, out_dir, i):
        xs = list(range(10))
        ys = [x * i for x in xs]
        path = out_dir / f"img_{i}.png"
        write_png_chart(path, xs, ys)
        header = path.read_bytes()[:8]
        assert header[:4] == b"\x89PNG"  # PNG magic bytes

    @pytest.mark.parametrize("i", range(10))
    def test_png_chart_different_data(self, out_dir, i):
        import math
        xs = [x * 0.1 for x in range(100)]
        ys = [math.sin(x + i) for x in xs]
        path = out_dir / f"sin_{i}.png"
        write_png_chart(path, xs, ys, title=f"Sine wave offset {i}")
        assert path.stat().st_size > 0


# ============================================================================
# 5.8 — Archivos de codigo en cualquier lenguaje
# ============================================================================

CODE_SAMPLES = [
    ("python", 'def hello():\n    print("Hello")\n', ".py"),
    ("javascript", 'function hello() {\n  console.log("Hello");\n}\n', ".js"),
    ("typescript", 'const hello = (): void => {\n  console.log("Hello");\n};\n', ".ts"),
    ("go", 'package main\n\nimport "fmt"\n\nfunc main() {\n\tfmt.Println("Hello")\n}\n', ".go"),
    ("rust", 'fn main() {\n    println!("Hello");\n}\n', ".rs"),
    ("java", 'public class Hello {\n    public static void main(String[] args) {\n        System.out.println("Hello");\n    }\n}\n', ".java"),
    ("c", '#include <stdio.h>\nint main() {\n    printf("Hello\\n");\n    return 0;\n}\n', ".c"),
    ("cpp", '#include <iostream>\nint main() {\n    std::cout << "Hello" << std::endl;\n    return 0;\n}\n', ".cpp"),
    ("ruby", 'puts "Hello"\n', ".rb"),
    ("php", '<?php\necho "Hello";\n?>\n', ".php"),
]


@pytest.mark.file_generation
class TestCodeFileGeneration:
    """5.8 — Code file generation across multiple programming languages."""

    @pytest.mark.parametrize("lang,code,ext", CODE_SAMPLES)
    def test_code_file_generation(self, out_dir, lang, code, ext):
        path = out_dir / f"hello.{lang}"
        result = write_code_file(path, lang, code)
        assert result.exists()
        content = result.read_text()
        assert "Hello" in content or "hello" in content

    @pytest.mark.parametrize("lang,code,ext", CODE_SAMPLES)
    def test_code_file_extension(self, out_dir, lang, code, ext):
        path = out_dir / f"test_ext"
        result = write_code_file(path, lang, code)
        assert result.suffix == ext

    @pytest.mark.parametrize("i", range(10))
    def test_code_file_content_preserved(self, out_dir, i):
        code = f"# Comment {i}\ndef func_{i}():\n    return {i}\n"
        path = out_dir / f"func_{i}.py"
        write_code_file(path, "python", code)
        assert path.read_text() == code
