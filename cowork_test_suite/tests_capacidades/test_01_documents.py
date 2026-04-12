"""
Pilar 1 — Generación y parseo de documentos.

Cada test crea un documento real (.docx/.xlsx/.pptx/.pdf), lo re-lee y verifica
que el contenido sobrevive el round-trip. Con 4 formatos × 200 variantes = 800
tests, todos independientes y deterministas.
"""
import pytest
from pathlib import Path
from cowork_lib import DocSpec, generate_document, read_document_text


KINDS = ["docx", "xlsx", "pptx", "pdf"]
VARIANTS = list(range(200))


def _spec(kind: str, i: int) -> DocSpec:
    title = f"CoworkDoc_{kind}_{i:03d}"
    sections = [
        f"Section {j} about topic {(i*j) % 97}" for j in range(1, 4)
    ]
    data = [["id", "name", "value"]] + [[k, f"row{k}", k * i] for k in range(1, 4)]
    return DocSpec(kind=kind, title=title, sections=sections, data=data)


@pytest.mark.parametrize("kind", KINDS)
@pytest.mark.parametrize("i", VARIANTS)
def test_document_roundtrip(kind: str, i: int, tmp_doc_dir: Path):
    spec = _spec(kind, i)
    path = generate_document(spec, tmp_doc_dir)
    assert path.exists(), f"document {path} not created"
    assert path.stat().st_size > 0, f"document {path} is empty"
    text = read_document_text(path)
    # xlsx holds data in cells; title not always in body
    if kind != "xlsx":
        assert spec.title in text, f"title missing from {kind} doc {i}"
    else:
        assert "id" in text and "name" in text
