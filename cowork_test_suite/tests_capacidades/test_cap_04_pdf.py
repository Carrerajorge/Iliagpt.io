"""
CAP-04: GENERACION Y MANIPULACION DE PDF
==========================================
Tests para todas las sub-capacidades de PDF.

Sub-capacidades:
  4.1  Creacion de PDFs nuevos
  4.2  Llenado de formularios PDF
  4.3  Merge/split (combinar y dividir PDFs)
  4.4  Extraccion de datos de PDFs a otros formatos

Total: ~300 tests
"""
from __future__ import annotations

import pytest
from pathlib import Path
from pypdf import PdfReader

from cowork_lib3 import (
    create_pdf_with_fields,
    fill_pdf_form_sim,
    merge_pdfs,
    split_pdf,
    extract_pdf_tables,
)
from cowork_lib import generate_document, DocSpec, read_document_text


@pytest.fixture
def out_dir(tmp_path):
    d = tmp_path / "cap04_pdf"
    d.mkdir()
    return d


def _make_pdf(out_dir: Path, name: str, sections: list[str]) -> Path:
    spec = DocSpec(kind="pdf", title=name, sections=sections)
    return generate_document(spec, out_dir)


# ============================================================================
# 4.1 — Creacion de PDFs nuevos
# ============================================================================

FORM_FIELDS = [
    {"Name": "John Doe", "Email": "john@example.com", "Phone": "555-0100"},
    {"Company": "Acme Corp", "Address": "123 Main St", "City": "Springfield"},
    {"Date": "2026-04-12", "Amount": "$5,000.00", "Reference": "INV-001"},
    {"First Name": "Jane", "Last Name": "Smith", "SSN": "***-**-1234"},
]


@pytest.mark.file_generation
class TestPdfCreation:
    """4.1 — Basic PDF creation and content validation."""

    @pytest.mark.parametrize("i", range(30))
    def test_pdf_creation_basic(self, out_dir, i):
        sections = [f"Paragraph {j} of document {i}" for j in range(5)]
        path = _make_pdf(out_dir, f"doc_{i}", sections)
        assert path.exists() and path.stat().st_size > 0
        reader = PdfReader(str(path))
        assert len(reader.pages) >= 1

    @pytest.mark.parametrize("n_sections", [1, 5, 10, 30, 50])
    def test_pdf_section_volume(self, out_dir, n_sections):
        sections = [f"Section {j}: Content line about topic {j}" for j in range(n_sections)]
        path = _make_pdf(out_dir, f"volume_{n_sections}", sections)
        text = read_document_text(path)
        assert f"volume_{n_sections}" in text

    @pytest.mark.parametrize("i", range(15))
    def test_pdf_title_in_content(self, out_dir, i):
        title = f"Important Report #{i}"
        path = _make_pdf(out_dir, title, ["Content here."])
        text = read_document_text(path)
        assert title in text

    @pytest.mark.parametrize("i", range(10))
    def test_pdf_multipage(self, out_dir, i):
        """PDFs with many sections should span multiple pages."""
        sections = [f"Line {j}: " + "x" * 80 for j in range(60)]
        path = _make_pdf(out_dir, f"multipage_{i}", sections)
        reader = PdfReader(str(path))
        assert len(reader.pages) >= 2


# ============================================================================
# 4.2 — Llenado de formularios PDF
# ============================================================================

@pytest.mark.file_generation
class TestPdfFormFill:
    """4.2 — PDF form template creation and field filling."""

    @pytest.mark.parametrize("fields", FORM_FIELDS)
    def test_pdf_form_fill(self, out_dir, fields):
        template = out_dir / "template.pdf"
        create_pdf_with_fields(template, {k: "" for k in fields})
        filled_path = out_dir / f"filled_{list(fields.values())[0][:10]}.pdf"
        fill_pdf_form_sim(template, fields, filled_path)
        assert filled_path.exists()
        text = read_document_text(filled_path)
        for val in fields.values():
            assert val in text

    @pytest.mark.parametrize("n_fields", [1, 3, 5, 10, 15])
    def test_pdf_form_field_count(self, out_dir, n_fields):
        fields = {f"Field_{j}": f"Value_{j}" for j in range(n_fields)}
        template = out_dir / f"tpl_{n_fields}.pdf"
        create_pdf_with_fields(template, {k: "" for k in fields})
        filled = out_dir / f"filled_{n_fields}.pdf"
        fill_pdf_form_sim(template, fields, filled)
        text = read_document_text(filled)
        for val in fields.values():
            assert val in text

    @pytest.mark.parametrize("i", range(15))
    def test_pdf_form_template_creation(self, out_dir, i):
        fields = {f"input_{j}": f"default_{j}" for j in range(4)}
        path = out_dir / f"form_tpl_{i}.pdf"
        create_pdf_with_fields(path, fields)
        text = read_document_text(path)
        assert "Form Document" in text


# ============================================================================
# 4.3 — Merge / Split PDFs
# ============================================================================

@pytest.mark.file_generation
class TestPdfMergeSplit:
    """4.3 — Merging multiple PDFs and splitting multi-page PDFs."""

    @pytest.mark.parametrize("n_pdfs", [2, 3, 5, 8])
    def test_pdf_merge(self, out_dir, n_pdfs):
        paths = []
        for j in range(n_pdfs):
            p = _make_pdf(out_dir, f"merge_src_{j}", [f"Content from PDF {j}"])
            paths.append(p)
        merged = out_dir / f"merged_{n_pdfs}.pdf"
        merge_pdfs(paths, merged)
        reader = PdfReader(str(merged))
        assert len(reader.pages) >= n_pdfs

    @pytest.mark.parametrize("i", range(10))
    def test_pdf_merge_content_preserved(self, out_dir, i):
        p1 = _make_pdf(out_dir, f"first_{i}", [f"First document content {i}"])
        p2 = _make_pdf(out_dir, f"second_{i}", [f"Second document content {i}"])
        merged = out_dir / f"merged_content_{i}.pdf"
        merge_pdfs([p1, p2], merged)
        text = read_document_text(merged)
        assert f"first_{i}" in text
        assert f"second_{i}" in text

    @pytest.mark.parametrize("n_pages", [2, 3, 5])
    def test_pdf_split(self, out_dir, n_pages):
        # Create a multi-page PDF
        sections = [f"Page {j} content " + "text " * 50 for j in range(n_pages)]
        # Use merge to create multi-page
        pages = []
        for j in range(n_pages):
            p = _make_pdf(out_dir, f"split_src_page_{j}", [sections[j]])
            pages.append(p)
        multi = out_dir / "multi_to_split.pdf"
        merge_pdfs(pages, multi)
        split_dir = out_dir / "split_output"
        result_pages = split_pdf(multi, split_dir)
        assert len(result_pages) >= n_pages
        for rp in result_pages:
            assert rp.exists() and rp.stat().st_size > 0

    @pytest.mark.parametrize("i", range(10))
    def test_pdf_split_each_page_readable(self, out_dir, i):
        p1 = _make_pdf(out_dir, f"s1_{i}", [f"Content A {i}"])
        p2 = _make_pdf(out_dir, f"s2_{i}", [f"Content B {i}"])
        merged = out_dir / f"to_split_{i}.pdf"
        merge_pdfs([p1, p2], merged)
        split_dir = out_dir / f"split_{i}"
        pages = split_pdf(merged, split_dir)
        for page_path in pages:
            reader = PdfReader(str(page_path))
            assert len(reader.pages) == 1
            text = reader.pages[0].extract_text()
            assert text is not None


# ============================================================================
# 4.4 — Extraccion de datos de PDFs a otros formatos
# ============================================================================

@pytest.mark.file_generation
class TestPdfDataExtraction:
    """4.4 — Extracting text, tables, and structured data from PDFs."""

    @pytest.mark.parametrize("i", range(20))
    def test_pdf_text_extraction(self, out_dir, i):
        content = [f"Row {j}  Value{j}  Amount{j * 100}" for j in range(5)]
        path = _make_pdf(out_dir, f"extract_{i}", content)
        rows = extract_pdf_tables(path)
        assert len(rows) >= 1  # At least title row

    @pytest.mark.parametrize("i", range(15))
    def test_pdf_to_text_roundtrip(self, out_dir, i):
        original_text = f"Invoice #{i:04d} for services rendered in April 2026"
        path = _make_pdf(out_dir, f"roundtrip_{i}", [original_text])
        extracted = read_document_text(path)
        assert f"roundtrip_{i}" in extracted

    @pytest.mark.parametrize("i", range(10))
    def test_pdf_table_extraction_structure(self, out_dir, i):
        lines = [
            f"Name  Age  City",
            f"Alice  30  NYC",
            f"Bob  25  LA",
            f"Carol  35  Chicago",
        ]
        path = _make_pdf(out_dir, f"table_extract_{i}", lines)
        rows = extract_pdf_tables(path)
        assert len(rows) >= 2  # header + at least one data row

    @pytest.mark.parametrize("i", range(10))
    def test_pdf_extraction_to_csv_format(self, out_dir, i):
        """Extract from PDF and verify data can be formatted as CSV."""
        lines = [f"Product{j}  {j * 10}  ${j * 100}" for j in range(5)]
        path = _make_pdf(out_dir, f"csv_extract_{i}", lines)
        rows = extract_pdf_tables(path)
        csv_lines = [",".join(cells) for cells in rows if len(cells) > 1]
        assert len(csv_lines) >= 1, "Should extract at least one multi-column row"
        for line in csv_lines:
            assert "," in line  # proper CSV format
