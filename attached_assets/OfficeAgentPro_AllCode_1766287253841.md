# Office Agent Pro — Código completo (un solo documento)

> Copia y pega este documento a tu programador.  
> Contiene los archivos esenciales del proyecto (Word + Excel) separados por títulos.

---

## FILE: `requirements.txt`
```txt
pydantic>=2.6,<3
openpyxl>=3.1.2,<4
python-docx>=1.1.0,<2
fastapi>=0.110,<1
uvicorn[standard]>=0.27,<1
typer>=0.12,<1
requests>=2.31,<3
```

---

## FILE: `src/office_agent/config.py`
```python
from __future__ import annotations

from dataclasses import dataclass
import os


@dataclass(frozen=True)
class Settings:
    """Runtime settings.

    Mantener explícito y pequeño. Extender cuando sea necesario.
    """

    # API
    api_title: str = "Office Agent Pro"
    api_version: str = "0.1.0"

    # Límites (seguridad/DoS)
    max_sheets: int = 20
    max_total_cells: int = 2_000_000
    max_total_rows: int = 200_000
    max_block_count: int = 2_000
    max_text_len: int = 50_000
    max_table_cells: int = 200_000

    # Excel safety: escapar texto que parece fórmula
    excel_escape_formula_like_text: bool = True

    # Column auto-fit bounds (heurística)
    excel_col_min_width: float = 8.0
    excel_col_max_width: float = 60.0

    # Logging
    log_level: str = os.getenv("OFFICE_AGENT_LOG_LEVEL", "INFO")
    log_json: bool = os.getenv("OFFICE_AGENT_LOG_JSON", "0") == "1"


def get_settings() -> Settings:
    return Settings()
```

---

## FILE: `src/office_agent/errors.py`
```python
class OfficeAgentError(Exception):
    """Base error."""


class SchemaValidationError(OfficeAgentError):
    """Spec inválido vs schema."""


class QualityGateError(OfficeAgentError):
    """Quality gates con errores bloqueantes."""


class RenderError(OfficeAgentError):
    """Falló el render."""


class ValidationError(OfficeAgentError):
    """Falló validación post-render (archivo corrupto, etc.)."""
```

---

## FILE: `src/office_agent/logging.py`
```python
from __future__ import annotations

import json
import logging
import sys
from typing import Any, Dict

from .config import get_settings


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: Dict[str, Any] = {
            "level": record.levelname,
            "name": record.name,
            "message": record.getMessage(),
        }
        if record.exc_info:
            payload["exc_info"] = self.formatException(record.exc_info)
        if hasattr(record, "extra") and isinstance(record.extra, dict):
            payload.update(record.extra)
        return json.dumps(payload, ensure_ascii=False)


def setup_logging() -> None:
    settings = get_settings()
    root = logging.getLogger()
    root.handlers.clear()
    root.setLevel(getattr(logging, settings.log_level.upper(), logging.INFO))

    handler = logging.StreamHandler(sys.stdout)
    if settings.log_json:
        handler.setFormatter(JsonFormatter())
    else:
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
    root.addHandler(handler)
```

---

## FILE: `src/office_agent/schemas/common.py`
```python
from __future__ import annotations

import re
from typing import Any

_CELL_RE = re.compile(r"^[A-Z]{1,3}[1-9][0-9]{0,6}$")


def is_cell_ref(value: str) -> bool:
    return bool(_CELL_RE.match(value or ""))


def assert_cell_ref(value: str) -> str:
    if not is_cell_ref(value):
        raise ValueError(f"Invalid cell reference: {value!r} (expected like 'A1')")
    return value


def safe_str(value: Any) -> str:
    try:
        return "" if value is None else str(value)
    except Exception:
        return ""
```

---

## FILE: `src/office_agent/schemas/excel.py`
```python
from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .common import assert_cell_ref

_RANGE_RE = r"^[A-Z]{1,3}[1-9][0-9]{0,6}:[A-Z]{1,3}[1-9][0-9]{0,6}$"


class WorkbookMeta(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    title: Optional[str] = None
    author: Optional[str] = None


class TableStyleSpec(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    table_style: str = Field(default="TableStyleMedium9")
    header_bold: bool = True
    header_fill: Optional[str] = Field(default="D9E1F2")


class TableSpec(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    name: Optional[str] = None
    start_cell: str = Field(description="Top-left cell, e.g. 'A1'.")
    headers: List[str] = Field(min_length=1)
    rows: List[List[Any]] = Field(default_factory=list)
    style: TableStyleSpec = Field(default_factory=TableStyleSpec)
    auto_filter: bool = True

    number_formats: Dict[str, str] = Field(default_factory=dict)
    formulas: Dict[str, str] = Field(
        default_factory=dict,
        description="Header -> formula template with '{row}', e.g. {'Total': '=C{row}*D{row}'}",
    )

    @field_validator("start_cell")
    @classmethod
    def _validate_cell(cls, v: str) -> str:
        return assert_cell_ref(v)

    @field_validator("headers")
    @classmethod
    def _validate_headers(cls, v: List[str]) -> List[str]:
        if any(not h or not str(h).strip() for h in v):
            raise ValueError("headers must be non-empty strings")
        normalized = [h.strip() for h in v]
        if len(set(normalized)) != len(normalized):
            raise ValueError("headers must be unique")
        return normalized

    @model_validator(mode="after")
    def _validate_rows(self) -> "TableSpec":
        n = len(self.headers)
        for i, row in enumerate(self.rows):
            if len(row) != n:
                raise ValueError(f"Row {i} has {len(row)} cells but expected {n}")
        for k in self.number_formats.keys():
            if k not in self.headers:
                raise ValueError(f"number_formats references unknown header: {k!r}")
        for k in self.formulas.keys():
            if k not in self.headers:
                raise ValueError(f"formulas references unknown header: {k!r}")
        return self


class CellSpec(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    cell: str
    value: Any = None
    formula: Optional[str] = None
    number_format: Optional[str] = None
    bold: bool = False

    @field_validator("cell")
    @classmethod
    def _validate_cell(cls, v: str) -> str:
        return assert_cell_ref(v)

    @model_validator(mode="after")
    def _exclusive_value_formula(self) -> "CellSpec":
        if self.formula is not None and self.value not in (None, ""):
            raise ValueError("CellSpec: provide either 'value' or 'formula', not both")
        return self


class ChartSpec(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    type: Literal["bar", "line", "pie"] = "bar"
    title: Optional[str] = None
    data_range: str = Field(pattern=_RANGE_RE)
    categories_range: Optional[str] = Field(default=None, pattern=_RANGE_RE)
    position_cell: str = Field(default="H2")

    @field_validator("position_cell")
    @classmethod
    def _validate_pos(cls, v: str) -> str:
        return assert_cell_ref(v)


class SheetLayout(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    freeze_panes: Optional[str] = None
    column_widths: Dict[str, float] = Field(default_factory=dict)
    row_heights: Dict[int, float] = Field(default_factory=dict)
    auto_filter: bool = False

    @field_validator("freeze_panes")
    @classmethod
    def _validate_freeze(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        return assert_cell_ref(v)

    @field_validator("column_widths")
    @classmethod
    def _validate_col_widths(cls, v: Dict[str, float]) -> Dict[str, float]:
        for col, w in v.items():
            if not isinstance(col, str) or not col.isalpha() or len(col) > 3:
                raise ValueError(f"Invalid column key: {col!r}")
            if w <= 0:
                raise ValueError(f"Column width must be > 0 for {col}")
        return {col.upper(): float(w) for col, w in v.items()}


class SheetSpec(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    name: str = Field(min_length=1, max_length=31)
    tables: List[TableSpec] = Field(default_factory=list)
    cells: List[CellSpec] = Field(default_factory=list)
    charts: List[ChartSpec] = Field(default_factory=list)
    layout: SheetLayout = Field(default_factory=SheetLayout)


class ExcelSpec(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    meta: WorkbookMeta = Field(default_factory=WorkbookMeta)
    sheets: List[SheetSpec] = Field(min_length=1)
```

---

## FILE: `src/office_agent/schemas/word.py`
```python
from __future__ import annotations

from typing import Any, List, Literal, Optional, Union, Annotated

from pydantic import BaseModel, ConfigDict, Field, model_validator, field_validator


class DocMeta(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    title: Optional[str] = None
    author: Optional[str] = None


class TitleBlock(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    type: Literal["title"] = "title"
    text: str = Field(min_length=1)


class HeadingBlock(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    type: Literal["heading"] = "heading"
    level: int = Field(ge=1, le=6)
    text: str = Field(min_length=1)


class ParagraphBlock(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    type: Literal["paragraph"] = "paragraph"
    text: str = Field(min_length=1)
    style: Optional[str] = None


class BulletsBlock(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    type: Literal["bullets"] = "bullets"
    items: List[str] = Field(min_length=1)


class NumberedBlock(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    type: Literal["numbered"] = "numbered"
    items: List[str] = Field(min_length=1)


class TableBlock(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    type: Literal["table"] = "table"
    columns: List[str] = Field(min_length=1)
    rows: List[List[Any]] = Field(default_factory=list)
    style: str = Field(default="Table Grid")
    header: bool = True

    @field_validator("columns")
    @classmethod
    def _validate_cols(cls, v: List[str]) -> List[str]:
        if any(not c or not str(c).strip() for c in v):
            raise ValueError("columns must be non-empty strings")
        normalized = [c.strip() for c in v]
        if len(set(normalized)) != len(normalized):
            raise ValueError("columns must be unique")
        return normalized

    @model_validator(mode="after")
    def _validate_rows(self) -> "TableBlock":
        n = len(self.columns)
        for i, row in enumerate(self.rows):
            if len(row) != n:
                raise ValueError(f"Row {i} has {len(row)} cells but expected {n}")
        return self


class PageBreakBlock(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    type: Literal["page_break"] = "page_break"


class TocBlock(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    type: Literal["toc"] = "toc"
    max_level: int = Field(default=3, ge=1, le=6)


DocBlock = Annotated[
    Union[
        TitleBlock,
        HeadingBlock,
        ParagraphBlock,
        BulletsBlock,
        NumberedBlock,
        TableBlock,
        PageBreakBlock,
        TocBlock,
    ],
    Field(discriminator="type"),
]


class DocSpec(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    meta: DocMeta = Field(default_factory=DocMeta)
    styleset: str = Field(default="modern")
    blocks: List[DocBlock] = Field(min_length=1)
```

---

## FILE: `src/office_agent/renderers/utils_excel.py`
```python
from __future__ import annotations

import re
from typing import Any, Iterable, Tuple

from openpyxl.utils import column_index_from_string, get_column_letter
from openpyxl.utils.cell import coordinate_from_string, range_boundaries


def cell_to_rowcol(cell: str) -> Tuple[int, int]:
    col_letters, row = coordinate_from_string(cell)
    return int(row), column_index_from_string(col_letters)


def rowcol_to_cell(row: int, col: int) -> str:
    return f"{get_column_letter(col)}{row}"


def bounds_from_range(rng: str) -> Tuple[int, int, int, int]:
    return range_boundaries(rng)


def safe_table_name(name: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9_]", "_", name.strip())
    if not cleaned:
        cleaned = "Table1"
    if not re.match(r"^[A-Za-z_]", cleaned):
        cleaned = f"T_{cleaned}"
    return cleaned[:255]


def heuristic_col_width(values: Iterable[Any], min_w: float, max_w: float) -> float:
    max_len = 0
    for v in values:
        s = "" if v is None else str(v)
        max_len = max(max_len, len(s))
    width = float(max_len + 2)
    width = max(width, min_w)
    width = min(width, max_w)
    return width
```

---

## FILE: `src/office_agent/renderers/excel.py`
```python
from __future__ import annotations

from io import BytesIO
from typing import Dict, List, Tuple, Any

from openpyxl import Workbook
from openpyxl.chart import BarChart, LineChart, PieChart, Reference
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.worksheet.table import Table, TableStyleInfo
from openpyxl.utils import get_column_letter
from openpyxl.utils.cell import range_boundaries

from ..config import get_settings
from ..errors import RenderError
from ..schemas.excel import ExcelSpec, SheetSpec, TableSpec, ChartSpec, CellSpec
from .utils_excel import cell_to_rowcol, rowcol_to_cell, safe_table_name, heuristic_col_width

_FORMULA_PREFIXES = ("=", "+", "-", "@")  # formula injection primitives


def render_excel_bytes(spec: ExcelSpec) -> bytes:
    try:
        wb = Workbook()
        default = wb.active
        wb.remove(default)

        if spec.meta.title:
            wb.properties.title = spec.meta.title
        if spec.meta.author:
            wb.properties.creator = spec.meta.author

        for sheet_idx, sheet in enumerate(spec.sheets):
            ws = wb.create_sheet(title=sheet.name, index=sheet_idx)
            _render_sheet(ws, sheet)

        out = BytesIO()
        wb.save(out)
        return out.getvalue()
    except Exception as e:
        raise RenderError(f"Excel render failed: {e}") from e


def _render_sheet(ws, sheet: SheetSpec) -> None:
    for c in sheet.cells:
        _write_cell(ws, c)

    table_ranges: List[Tuple[str, TableSpec]] = []
    for idx, table in enumerate(sheet.tables, start=1):
        rng = _write_table(ws, table, idx)
        table_ranges.append((rng, table))

    if sheet.layout.freeze_panes:
        ws.freeze_panes = sheet.layout.freeze_panes
    else:
        for _rng, t in table_ranges:
            start_row, _ = cell_to_rowcol(t.start_cell)
            if start_row == 1:
                ws.freeze_panes = rowcol_to_cell(start_row + 1, 1)
                break

    for col, w in sheet.layout.column_widths.items():
        ws.column_dimensions[col].width = float(w)

    for row, h in sheet.layout.row_heights.items():
        ws.row_dimensions[int(row)].height = float(h)

    for chart in sheet.charts:
        _render_chart(ws, chart)


def _write_cell(ws, cell: CellSpec) -> None:
    settings = get_settings()
    r, c = cell_to_rowcol(cell.cell)
    x = ws.cell(row=r, column=c)

    if cell.formula is not None:
        x.value = cell.formula
    else:
        x.value = _maybe_escape_text(cell.value, enabled=settings.excel_escape_formula_like_text)

    if cell.number_format:
        x.number_format = cell.number_format
    if cell.bold:
        x.font = Font(bold=True)


def _write_table(ws, table: TableSpec, index: int) -> str:
    settings = get_settings()

    start_row, start_col = cell_to_rowcol(table.start_cell)
    ncols = len(table.headers)

    header_font = Font(bold=table.style.header_bold)
    header_fill = PatternFill("solid", fgColor=table.style.header_fill) if table.style.header_fill else None
    header_align = Alignment(horizontal="center", vertical="center", wrap_text=True)

    for j, h in enumerate(table.headers):
        cell = ws.cell(row=start_row, column=start_col + j, value=h)
        cell.font = header_font
        cell.alignment = header_align
        if header_fill:
            cell.fill = header_fill

    formula_headers = set(table.formulas.keys())

    for i, row in enumerate(table.rows, start=1):
        target_row = start_row + i
        for j, val in enumerate(row):
            header = table.headers[j]
            cell_obj = ws.cell(row=target_row, column=start_col + j)
            if header in formula_headers:
                cell_obj.value = None
            else:
                cell_obj.value = _maybe_escape_text(val, enabled=settings.excel_escape_formula_like_text)

    for header, template in table.formulas.items():
        col_index = table.headers.index(header)
        col = start_col + col_index
        for i in range(1, 1 + len(table.rows)):
            r = start_row + i
            ws.cell(row=r, column=col).value = template.format(row=r)

    header_to_col: Dict[str, int] = {h: start_col + idx for idx, h in enumerate(table.headers)}
    for header, fmt in table.number_formats.items():
        col = header_to_col[header]
        for r in range(start_row + 1, start_row + 1 + len(table.rows)):
            ws.cell(row=r, column=col).number_format = fmt

    end_row = start_row + len(table.rows)
    end_col = start_col + ncols - 1
    rng = f"{get_column_letter(start_col)}{start_row}:{get_column_letter(end_col)}{end_row}"

    display_name = safe_table_name(table.name or f"Table_{index}")
    excel_table = Table(displayName=display_name, ref=rng)
    excel_table.tableStyleInfo = TableStyleInfo(
        name=table.style.table_style,
        showFirstColumn=False,
        showLastColumn=False,
        showRowStripes=True,
        showColumnStripes=False,
    )
    ws.add_table(excel_table)

    for j, h in enumerate(table.headers):
        col_letter = get_column_letter(start_col + j)
        if ws.column_dimensions[col_letter].width is not None:
            continue
        col_values = [h] + [row[j] for row in table.rows]
        ws.column_dimensions[col_letter].width = heuristic_col_width(
            col_values, settings.excel_col_min_width, settings.excel_col_max_width
        )

    return rng


def _render_chart(ws, chart: ChartSpec) -> None:
    min_col, min_row, max_col, max_row = range_boundaries(chart.data_range)
    data_ref = Reference(ws, min_col=min_col, min_row=min_row, max_col=max_col, max_row=max_row)

    if chart.type == "bar":
        ch = BarChart()
        ch.add_data(data_ref, titles_from_data=True)
    elif chart.type == "line":
        ch = LineChart()
        ch.add_data(data_ref, titles_from_data=True)
    elif chart.type == "pie":
        ch = PieChart()
        values_ref = Reference(ws, min_col=max_col, min_row=min_row + 1, max_col=max_col, max_row=max_row)
        ch.add_data(values_ref, titles_from_data=False)
    else:
        raise RenderError(f"Unsupported chart type: {chart.type}")

    if chart.title:
        ch.title = chart.title

    if chart.categories_range:
        cmin_col, cmin_row, cmax_col, cmax_row = range_boundaries(chart.categories_range)
        cat_ref = Reference(ws, min_col=cmin_col, min_row=cmin_row + 1, max_col=cmax_col, max_row=cmax_row)
        try:
            ch.set_categories(cat_ref)
        except Exception:
            pass
    else:
        if max_col > min_col:
            cat_ref = Reference(ws, min_col=min_col, min_row=min_row + 1, max_col=min_col, max_row=max_row)
            try:
                ch.set_categories(cat_ref)
            except Exception:
                pass

    ws.add_chart(ch, chart.position_cell)


def _maybe_escape_text(value: Any, *, enabled: bool) -> Any:
    if not enabled:
        return value
    if isinstance(value, str) and value.startswith(_FORMULA_PREFIXES):
        return "'" + value
    return value
```

---

## FILE: `src/office_agent/renderers/utils_word.py`
```python
from __future__ import annotations

from docx.oxml import OxmlElement
from docx.oxml.ns import qn


def add_toc(paragraph, max_level: int = 3) -> None:
    run = paragraph.add_run()

    fld_begin = OxmlElement("w:fldChar")
    fld_begin.set(qn("w:fldCharType"), "begin")

    instr = OxmlElement("w:instrText")
    instr.set(qn("xml:space"), "preserve")
    instr.text = f'TOC \\o "1-{max_level}" \\h \\z \\u'

    fld_sep = OxmlElement("w:fldChar")
    fld_sep.set(qn("w:fldCharType"), "separate")

    fld_end = OxmlElement("w:fldChar")
    fld_end.set(qn("w:fldCharType"), "end")

    run._r.append(fld_begin)
    run._r.append(instr)
    run._r.append(fld_sep)

    t = OxmlElement("w:t")
    t.text = "Tabla de contenido (actualiza campos en tu editor)"
    run._r.append(t)

    run._r.append(fld_end)
```

---

## FILE: `src/office_agent/renderers/word.py`
```python
from __future__ import annotations

from io import BytesIO

from docx import Document
from docx.shared import Pt
from docx.table import Table as DocxTable

from ..errors import RenderError
from ..schemas.word import (
    DocSpec,
    TitleBlock,
    HeadingBlock,
    ParagraphBlock,
    BulletsBlock,
    NumberedBlock,
    TableBlock,
    PageBreakBlock,
    TocBlock,
)
from .utils_word import add_toc


def render_word_bytes(spec: DocSpec) -> bytes:
    try:
        doc = Document()
        _apply_styleset(doc, spec.styleset)

        for block in spec.blocks:
            if isinstance(block, TitleBlock):
                doc.add_paragraph(block.text, style="Title")
            elif isinstance(block, HeadingBlock):
                doc.add_paragraph(block.text, style=f"Heading {block.level}")
            elif isinstance(block, ParagraphBlock):
                p = doc.add_paragraph(style=block.style or "Normal")
                p.add_run(block.text)
            elif isinstance(block, BulletsBlock):
                for item in block.items:
                    doc.add_paragraph(str(item), style="List Bullet")
            elif isinstance(block, NumberedBlock):
                for item in block.items:
                    doc.add_paragraph(str(item), style="List Number")
            elif isinstance(block, TableBlock):
                _render_table(doc, block)
            elif isinstance(block, PageBreakBlock):
                doc.add_page_break()
            elif isinstance(block, TocBlock):
                p = doc.add_paragraph()
                add_toc(p, max_level=block.max_level)
            else:
                raise RenderError(f"Unsupported block type: {type(block)}")

        out = BytesIO()
        doc.save(out)
        return out.getvalue()
    except Exception as e:
        raise RenderError(f"Word render failed: {e}") from e


def _apply_styleset(doc: Document, styleset: str) -> None:
    normal = doc.styles["Normal"]
    font = normal.font
    if styleset == "classic":
        font.name = "Times New Roman"
        font.size = Pt(12)
    else:
        font.name = "Calibri"
        font.size = Pt(11)


def _render_table(doc: Document, block: TableBlock) -> DocxTable:
    ncols = len(block.columns)
    nrows = 1 + len(block.rows) if block.header else len(block.rows)
    table = doc.add_table(rows=nrows, cols=ncols)
    table.style = block.style

    row_offset = 0
    if block.header:
        hdr = table.rows[0].cells
        for j, col in enumerate(block.columns):
            hdr[j].text = str(col)
        row_offset = 1

    for i, row in enumerate(block.rows):
        cells = table.rows[i + row_offset].cells
        for j, val in enumerate(row):
            cells[j].text = "" if val is None else str(val)

    return table
```

---

## FILE: `src/office_agent/validators/excel.py`
```python
from __future__ import annotations

from io import BytesIO
from openpyxl import load_workbook

from ..errors import ValidationError


def validate_xlsx_bytes(data: bytes) -> None:
    try:
        wb = load_workbook(filename=BytesIO(data), data_only=False)
        if not wb.sheetnames:
            raise ValidationError("Workbook has no sheets")
    except Exception as e:
        raise ValidationError(f"Invalid XLSX output: {e}") from e
```

---

## FILE: `src/office_agent/validators/word.py`
```python
from __future__ import annotations

from io import BytesIO
from docx import Document

from ..errors import ValidationError


def validate_docx_bytes(data: bytes) -> None:
    try:
        doc = Document(BytesIO(data))
        _ = len(doc.paragraphs)
    except Exception as e:
        raise ValidationError(f"Invalid DOCX output: {e}") from e
```

---

## FILE: `src/office_agent/quality/report.py`
```python
from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Literal, Optional

Severity = Literal["error", "warning"]


@dataclass(frozen=True)
class QualityFinding:
    severity: Severity
    code: str
    message: str
    location: Optional[str] = None


@dataclass
class QualityReport:
    errors: List[QualityFinding] = field(default_factory=list)
    warnings: List[QualityFinding] = field(default_factory=list)

    def add(self, finding: QualityFinding) -> None:
        if finding.severity == "error":
            self.errors.append(finding)
        else:
            self.warnings.append(finding)

    def to_dict(self) -> dict:
        return {
            "errors": [f.__dict__ for f in self.errors],
            "warnings": [f.__dict__ for f in self.warnings],
        }
```

---

## FILE: `src/office_agent/quality/rules_excel.py`
```python
from __future__ import annotations

from typing import Tuple, List

from ..config import get_settings
from ..schemas.excel import ExcelSpec, TableSpec
from ..renderers.utils_excel import cell_to_rowcol
from .report import QualityFinding, QualityReport

_FORMULA_PREFIXES = ("=", "+", "-", "@")


def run_quality_gates_excel(spec: ExcelSpec) -> QualityReport:
    s = get_settings()
    report = QualityReport()

    if len(spec.sheets) > s.max_sheets:
        report.add(QualityFinding("error", "excel.too_many_sheets",
                                  f"Too many sheets: {len(spec.sheets)} > {s.max_sheets}"))

    names = [sh.name.lower() for sh in spec.sheets]
    if len(set(names)) != len(names):
        report.add(QualityFinding("error", "excel.duplicate_sheet_names",
                                  "Duplicate sheet names (case-insensitive) are not allowed."))

    total_rows = 0
    total_cells = 0
    table_cells = 0

    for sh in spec.sheets:
        rects: List[Tuple[int, int, int, int, str]] = []
        for idx, t in enumerate(sh.tables, start=1):
            r = _table_rect(t)
            rects.append((*r, f"{sh.name}:table[{idx}]"))

        for i in range(len(rects)):
            for j in range(i + 1, len(rects)):
                if _rect_intersect(rects[i][:4], rects[j][:4]):
                    report.add(QualityFinding("error", "excel.table_overlap",
                                              f"Tables overlap: {rects[i][4]} intersects {rects[j][4]}"))

        for t in sh.tables:
            total_rows += len(t.rows)
            total_cells += (len(t.headers) * (1 + len(t.rows)))
            table_cells += (len(t.headers) * (1 + len(t.rows)))

            formula_headers = set(t.formulas.keys())
            for row_i, row in enumerate(t.rows):
                for col_i, val in enumerate(row):
                    if isinstance(val, str) and val.startswith(_FORMULA_PREFIXES):
                        header = t.headers[col_i]
                        if header not in formula_headers:
                            report.add(QualityFinding(
                                "warning", "excel.formula_like_text",
                                f"Value looks like formula in sheet '{sh.name}', column '{header}', row {row_i+1}. "
                                "It will be escaped as text.",
                                location=f"{sh.name}:{t.start_cell}",
                            ))

        total_cells += len(sh.cells)

    if total_rows > s.max_total_rows:
        report.add(QualityFinding("error", "excel.too_many_rows",
                                  f"Total rows too large: {total_rows} > {s.max_total_rows}"))

    if total_cells > s.max_total_cells:
        report.add(QualityFinding("error", "excel.too_many_cells",
                                  f"Total cells too large: {total_cells} > {s.max_total_cells}"))

    if table_cells > s.max_table_cells:
        report.add(QualityFinding("error", "excel.too_many_table_cells",
                                  f"Total table cells too large: {table_cells} > {s.max_table_cells}"))

    return report


def _table_rect(t: TableSpec) -> Tuple[int, int, int, int]:
    start_row, start_col = cell_to_rowcol(t.start_cell)
    end_row = start_row + len(t.rows)
    end_col = start_col + len(t.headers) - 1
    return start_row, start_col, end_row, end_col


def _rect_intersect(a: Tuple[int, int, int, int], b: Tuple[int, int, int, int]) -> bool:
    a_min_r, a_min_c, a_max_r, a_max_c = a
    b_min_r, b_min_c, b_max_r, b_max_c = b
    return not (a_max_r < b_min_r or b_max_r < a_min_r or a_max_c < b_min_c or b_max_c < a_min_c)
```

---

## FILE: `src/office_agent/quality/rules_word.py`
```python
from __future__ import annotations

from ..config import get_settings
from ..schemas.word import DocSpec, ParagraphBlock, TableBlock, TitleBlock, TocBlock
from .report import QualityFinding, QualityReport


def run_quality_gates_word(spec: DocSpec) -> QualityReport:
    s = get_settings()
    report = QualityReport()

    if len(spec.blocks) > s.max_block_count:
        report.add(QualityFinding("error", "word.too_many_blocks",
                                  f"Too many blocks: {len(spec.blocks)} > {s.max_block_count}"))

    title_count = sum(1 for b in spec.blocks if isinstance(b, TitleBlock))
    if title_count > 1:
        report.add(QualityFinding("warning", "word.multiple_titles",
                                  f"Document has {title_count} title blocks; usually it's 0 or 1."))

    toc_positions = [i for i, b in enumerate(spec.blocks) if isinstance(b, TocBlock)]
    if toc_positions and toc_positions[0] > 5:
        report.add(QualityFinding("warning", "word.toc_late",
                                  "TOC appears late; typical placement is near the top."))

    table_cells = 0
    for idx, b in enumerate(spec.blocks):
        if isinstance(b, ParagraphBlock) and len(b.text) > s.max_text_len:
            report.add(QualityFinding("error", "word.paragraph_too_long",
                                      f"Paragraph block {idx} too long: {len(b.text)} > {s.max_text_len}"))
        if isinstance(b, TableBlock):
            table_cells += (len(b.columns) * (len(b.rows) + (1 if b.header else 0)))

    if table_cells > s.max_table_cells:
        report.add(QualityFinding("error", "word.too_many_table_cells",
                                  f"Too many table cells: {table_cells} > {s.max_table_cells}"))

    return report
```

---

## FILE: `src/office_agent/llm/base.py`
```python
from __future__ import annotations

from abc import ABC, abstractmethod
from typing import List, Dict


class LLMClient(ABC):
    """Interfaz mínima para un LLM tipo chat."""

    @abstractmethod
    def chat(self, messages: List[Dict[str, str]], *, temperature: float = 0.0) -> str:
        raise NotImplementedError
```

---

## FILE: `src/office_agent/llm/openai_compat.py`
```python
from __future__ import annotations

from typing import Dict, List
import os
import requests

from .base import LLMClient


class OpenAICompatibleChatLLM(LLMClient):
    """Cliente de Chat Completions estilo OpenAI-compatible.

    POST {base_url}/chat/completions
    payload: { model, messages, temperature, response_format? }
    """

    def __init__(self, base_url: str, api_key: str, model: str):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.model = model

    @classmethod
    def from_env(cls) -> "OpenAICompatibleChatLLM":
        base_url = os.getenv("OA_COMPAT_BASE_URL", "http://localhost:8001/v1")
        api_key = os.getenv("OA_COMPAT_API_KEY", "changeme")
        model = os.getenv("OA_COMPAT_MODEL", "gpt-4o-mini")
        return cls(base_url=base_url, api_key=api_key, model=model)

    def chat(self, messages: List[Dict[str, str]], *, temperature: float = 0.0) -> str:
        url = f"{self.base_url}/chat/completions"
        headers = {"Authorization": f"Bearer {self.api_key}"}
        payload = {
            "model": self.model,
            "messages": messages,
            "temperature": temperature,
            "response_format": {"type": "json_object"},
        }
        r = requests.post(url, json=payload, headers=headers, timeout=60)
        r.raise_for_status()
        data = r.json()
        return data["choices"][0]["message"]["content"]
```

---

## FILE: `src/office_agent/llm/dummy.py`
```python
from __future__ import annotations

import json
from typing import Dict, List

from .base import LLMClient


class DummyLLM(LLMClient):
    """LLM determinista de demo: devuelve specs válidos pequeños."""

    def __init__(self, mode: str = "excel"):
        self.mode = mode

    def chat(self, messages: List[Dict[str, str]], *, temperature: float = 0.0) -> str:
        user = next((m["content"] for m in reversed(messages) if m["role"] == "user"), "")
        if "word" in user.lower() or self.mode == "word":
            return json.dumps(_sample_doc_spec(), ensure_ascii=False)
        return json.dumps(_sample_excel_spec(), ensure_ascii=False)


def _sample_excel_spec() -> dict:
    return {
        "meta": {"title": "Reporte Demo", "author": "Office Agent Pro"},
        "sheets": [
            {
                "name": "Resumen",
                "tables": [
                    {
                        "name": "Ventas",
                        "start_cell": "A1",
                        "headers": ["Producto", "Unidades", "Precio", "Total"],
                        "rows": [
                            ["A", 120, 9.99, None],
                            ["B", 80, 14.5, None],
                            ["C", 45, 22.0, None],
                        ],
                        "number_formats": {"Precio": "$#,##0.00", "Total": "$#,##0.00"},
                        "formulas": {"Total": "=B{row}*C{row}"},
                        "style": {"table_style": "TableStyleMedium9", "header_bold": True, "header_fill": "D9E1F2"},
                        "auto_filter": True,
                    }
                ],
                "charts": [
                    {"type": "bar", "title": "Unidades por producto", "data_range": "A1:B4", "position_cell": "F2"}
                ],
                "layout": {"freeze_panes": "A2"},
                "cells": [],
            }
        ],
    }


def _sample_doc_spec() -> dict:
    return {
        "meta": {"title": "Reporte Demo", "author": "Office Agent Pro"},
        "styleset": "modern",
        "blocks": [
            {"type": "title", "text": "Reporte Demo"},
            {"type": "toc", "max_level": 3},
            {"type": "heading", "level": 1, "text": "Resumen"},
            {"type": "paragraph", "text": "Documento generado desde JSON estricto."},
            {"type": "heading", "level": 1, "text": "Hallazgos"},
            {"type": "bullets", "items": ["Salida determinística", "Validación post-render", "Gates de calidad"]},
            {"type": "heading", "level": 1, "text": "Tabla"},
            {
                "type": "table",
                "columns": ["Plan", "Precio"],
                "rows": [["Basic", "$999"], ["Pro", "$2,499"]],
                "style": "Table Grid",
                "header": True,
            },
        ],
    }
```

---

## FILE: `src/office_agent/orchestrator/prompts.py`
```python
from __future__ import annotations

EXCEL_SYSTEM = (
    "Eres un generador de JSON estrictos para ExcelSpec. "
    "Devuelve SOLO JSON válido y nada más. "
    "No inventes campos. Respeta el schema."
)

WORD_SYSTEM = (
    "Eres un generador de JSON estrictos para DocSpec (Word). "
    "Devuelve SOLO JSON válido y nada más. "
    "No inventes campos. Respeta el schema."
)

REPAIR_SYSTEM = (
    "Tu tarea es reparar un JSON inválido para que cumpla el schema. "
    "Devuelve SOLO JSON válido. No incluyas explicaciones."
)
```

---

## FILE: `src/office_agent/orchestrator/repair.py`
```python
from __future__ import annotations

from typing import Dict, List

from ..llm.base import LLMClient
from .prompts import REPAIR_SYSTEM


def repair_json(
    llm: LLMClient,
    *,
    bad_json: str,
    validation_error: str,
    target: str,
    user_prompt: str,
) -> str:
    messages: List[Dict[str, str]] = [
        {"role": "system", "content": REPAIR_SYSTEM},
        {
            "role": "user",
            "content": (
                f"Objetivo: reparar JSON para target={target}.\n"
                f"PROMPT ORIGINAL:\n{user_prompt}\n\n"
                f"JSON ACTUAL (inválido):\n{bad_json}\n\n"
                f"ERROR DE VALIDACIÓN:\n{validation_error}\n\n"
                "Devuelve únicamente el JSON corregido."
            ),
        },
    ]
    return llm.chat(messages, temperature=0.0)
```

---

## FILE: `src/office_agent/orchestrator/agent.py`
```python
from __future__ import annotations

from typing import Dict, List, Tuple

from pydantic import ValidationError as PydanticValidationError

from ..llm.base import LLMClient
from ..schemas.excel import ExcelSpec
from ..schemas.word import DocSpec
from ..quality.rules_excel import run_quality_gates_excel
from ..quality.rules_word import run_quality_gates_word
from ..errors import SchemaValidationError, QualityGateError
from .prompts import EXCEL_SYSTEM, WORD_SYSTEM
from .repair import repair_json


def generate_excel_spec(prompt: str, llm: LLMClient, *, max_attempts: int = 3) -> Tuple[ExcelSpec, dict]:
    json_text = _first_attempt(llm, system=EXCEL_SYSTEM, prompt=prompt)
    spec = _validate_with_repairs_excel(prompt, llm, json_text, max_attempts=max_attempts)

    q = run_quality_gates_excel(spec)
    if q.errors:
        raise QualityGateError(str(q.to_dict()))
    return spec, q.to_dict()


def generate_word_spec(prompt: str, llm: LLMClient, *, max_attempts: int = 3) -> Tuple[DocSpec, dict]:
    json_text = _first_attempt(llm, system=WORD_SYSTEM, prompt=prompt)
    spec = _validate_with_repairs_word(prompt, llm, json_text, max_attempts=max_attempts)

    q = run_quality_gates_word(spec)
    if q.errors:
        raise QualityGateError(str(q.to_dict()))
    return spec, q.to_dict()


def _first_attempt(llm: LLMClient, *, system: str, prompt: str) -> str:
    messages: List[Dict[str, str]] = [
        {"role": "system", "content": system},
        {"role": "user", "content": prompt},
    ]
    return llm.chat(messages, temperature=0.0)


def _validate_with_repairs_excel(prompt: str, llm: LLMClient, json_text: str, *, max_attempts: int) -> ExcelSpec:
    current = json_text
    last_error = None
    for _ in range(max_attempts):
        try:
            return ExcelSpec.model_validate_json(current)
        except PydanticValidationError as e:
            last_error = str(e)
            current = repair_json(llm, bad_json=current, validation_error=last_error, target="excel", user_prompt=prompt)
    raise SchemaValidationError(f"ExcelSpec validation failed after {max_attempts} attempts: {last_error}")


def _validate_with_repairs_word(prompt: str, llm: LLMClient, json_text: str, *, max_attempts: int) -> DocSpec:
    current = json_text
    last_error = None
    for _ in range(max_attempts):
        try:
            return DocSpec.model_validate_json(current)
        except PydanticValidationError as e:
            last_error = str(e)
            current = repair_json(llm, bad_json=current, validation_error=last_error, target="word", user_prompt=prompt)
    raise SchemaValidationError(f"DocSpec validation failed after {max_attempts} attempts: {last_error}")
```

---

## FILE: `src/office_agent/api/app.py`
```python
from __future__ import annotations

import logging
import os
import uuid
from typing import Any, Dict

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response

from ..config import get_settings
from ..logging import setup_logging
from ..schemas.excel import ExcelSpec
from ..schemas.word import DocSpec
from ..renderers.excel import render_excel_bytes
from ..renderers.word import render_word_bytes
from ..validators.excel import validate_xlsx_bytes
from ..validators.word import validate_docx_bytes
from ..quality.rules_excel import run_quality_gates_excel
from ..quality.rules_word import run_quality_gates_word
from ..llm.dummy import DummyLLM
from ..llm.openai_compat import OpenAICompatibleChatLLM
from ..orchestrator.agent import generate_excel_spec, generate_word_spec

setup_logging()
log = logging.getLogger("office_agent.api")

settings = get_settings()
app = FastAPI(title=settings.api_title, version=settings.api_version)


@app.middleware("http")
async def add_request_id(request: Request, call_next):
    rid = request.headers.get("x-request-id") or str(uuid.uuid4())
    request.state.request_id = rid
    response = await call_next(request)
    response.headers["x-request-id"] = rid
    return response


@app.get("/health")
def health() -> Dict[str, str]:
    return {"status": "ok"}


def _llm_from_env():
    provider = os.getenv("OFFICE_AGENT_LLM_PROVIDER", "dummy").lower()
    if provider in ("oa", "openai_compat", "openai-compatible"):
        return OpenAICompatibleChatLLM.from_env()
    return DummyLLM()


@app.post("/v1/render/excel")
async def render_excel(spec: ExcelSpec) -> Response:
    q = run_quality_gates_excel(spec)
    if q.errors:
        return JSONResponse(status_code=422, content={"error": "quality_gate", "report": q.to_dict()})

    data = render_excel_bytes(spec)
    validate_xlsx_bytes(data)

    return Response(
        content=data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="document.xlsx"'},
    )


@app.post("/v1/render/word")
async def render_word(spec: DocSpec) -> Response:
    q = run_quality_gates_word(spec)
    if q.errors:
        return JSONResponse(status_code=422, content={"error": "quality_gate", "report": q.to_dict()})

    data = render_word_bytes(spec)
    validate_docx_bytes(data)

    return Response(
        content=data,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": 'attachment; filename="document.docx"'},
    )


@app.post("/v1/generate/excel")
async def generate_excel(payload: Dict[str, Any]) -> Response:
    prompt = str(payload.get("prompt", "")).strip()
    if not prompt:
        return JSONResponse(status_code=422, content={"error": "missing_prompt"})

    llm = _llm_from_env()
    spec, _ = generate_excel_spec(prompt, llm, max_attempts=3)

    data = render_excel_bytes(spec)
    validate_xlsx_bytes(data)

    return Response(
        content=data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="generated.xlsx"'},
    )


@app.post("/v1/generate/word")
async def generate_word(payload: Dict[str, Any]) -> Response:
    prompt = str(payload.get("prompt", "")).strip()
    if not prompt:
        return JSONResponse(status_code=422, content={"error": "missing_prompt"})

    llm = _llm_from_env()
    spec, _ = generate_word_spec(prompt, llm, max_attempts=3)

    data = render_word_bytes(spec)
    validate_docx_bytes(data)

    return Response(
        content=data,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": 'attachment; filename="generated.docx"'},
    )
```

---

## FILE: `scripts/generate_demo.py`
```python
from __future__ import annotations

from pathlib import Path

from office_agent.llm.dummy import DummyLLM
from office_agent.orchestrator.agent import generate_excel_spec, generate_word_spec
from office_agent.renderers.excel import render_excel_bytes
from office_agent.renderers.word import render_word_bytes

from office_agent.validators.excel import validate_xlsx_bytes
from office_agent.validators.word import validate_docx_bytes

OUT = Path("out")
OUT.mkdir(exist_ok=True)

prompt_excel = "Genera un Excel de ventas con tabla y gráfico."
prompt_word = "Genera un Word con secciones y una tabla."

llm = DummyLLM()

excel_spec, _ = generate_excel_spec(prompt_excel, llm)
word_spec, _ = generate_word_spec(prompt_word, llm)

xlsx = render_excel_bytes(excel_spec)
docx = render_word_bytes(word_spec)

validate_xlsx_bytes(xlsx)
validate_docx_bytes(docx)

(OUT / "report.xlsx").write_bytes(xlsx)
(OUT / "report.docx").write_bytes(docx)

print("Generated:", OUT / "report.xlsx", OUT / "report.docx")
```

---

## FILE: `scripts/validate_files.py`
```python
from __future__ import annotations

import sys
from pathlib import Path

from office_agent.validators.excel import validate_xlsx_bytes
from office_agent.validators.word import validate_docx_bytes

paths = [Path(p) for p in sys.argv[1:]]
if not paths:
    print("Usage: validate_files.py <file.xlsx> <file.docx> ...")
    raise SystemExit(2)

for p in paths:
    if p.suffix.lower() == ".xlsx":
        validate_xlsx_bytes(p.read_bytes())
        print("OK XLSX:", p)
    elif p.suffix.lower() == ".docx":
        validate_docx_bytes(p.read_bytes())
        print("OK DOCX:", p)
    else:
        print("Skip:", p)
```

---

## Cómo lo ejecuta tu programador (resumen)
1) Instalar deps  
2) `PYTHONPATH=src python scripts/generate_demo.py`  
3) `PYTHONPATH=src uvicorn office_agent.api.app:app --port 8000`  
4) Usar endpoints `/v1/render/*` o `/v1/generate/*`

