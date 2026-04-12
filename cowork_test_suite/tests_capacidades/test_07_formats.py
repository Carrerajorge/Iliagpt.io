"""
Capability 1c — Alternative output formats: md, html, csv, tsv, json, latex, png.
~700 tests.
"""
from __future__ import annotations

import json
import pathlib

import pytest

from cowork_lib2 import (
    write_markdown, write_html, write_csv, write_json, write_latex,
    write_png_chart, write_code_file,
)


N = 100


@pytest.mark.parametrize("i", range(N))
def test_markdown(tmp_path, i):
    p = write_markdown(tmp_path / f"d_{i}.md", f"Title {i}", [f"s{j}" for j in range(3)])
    txt = p.read_text(encoding="utf-8")
    assert f"# Title {i}" in txt
    assert "## Section 3" in txt


@pytest.mark.parametrize("i", range(N))
def test_html(tmp_path, i):
    body = f"<h1>Hello {i}</h1><p>body</p>"
    p = write_html(tmp_path / f"p_{i}.html", f"T{i}", body)
    assert f"<title>T{i}</title>" in p.read_text(encoding="utf-8")


@pytest.mark.parametrize("i", range(N))
def test_csv_and_tsv(tmp_path, i):
    rows = [["a", "b"], [str(i), str(i * 2)]]
    pc = write_csv(tmp_path / f"d_{i}.csv", rows)
    pt = write_csv(tmp_path / f"d_{i}.tsv", rows, delimiter="\t")
    assert f"{i},{i*2}" in pc.read_text()
    assert f"{i}\t{i*2}" in pt.read_text()


@pytest.mark.parametrize("i", range(N))
def test_json(tmp_path, i):
    obj = {"id": i, "vals": list(range(i % 5))}
    p = write_json(tmp_path / f"obj_{i}.json", obj)
    assert json.loads(p.read_text()) == obj


@pytest.mark.parametrize("i", range(N))
def test_latex(tmp_path, i):
    p = write_latex(tmp_path / f"tex_{i}.tex", f"Paper {i}", "Jorge", r"Section 1: \textbf{hola}")
    txt = p.read_text()
    assert r"\begin{document}" in txt and f"Paper {i}" in txt


@pytest.mark.parametrize("i", range(N))
def test_png_chart(tmp_path, i):
    xs = list(range(10))
    ys = [x * (i + 1) for x in xs]
    p = write_png_chart(tmp_path / f"chart_{i}.png", xs, ys, title=f"c{i}")
    assert p.exists() and p.stat().st_size > 200  # not empty


LANGUAGES = ["python", "javascript", "typescript", "go", "rust", "java", "c", "cpp", "sh", "ruby"] * 10


@pytest.mark.parametrize("lang", LANGUAGES)
def test_code_files(tmp_path, lang):
    p = write_code_file(tmp_path / f"hello_{lang}", lang, "hello world")
    assert p.exists()
    assert p.read_text() == "hello world"
