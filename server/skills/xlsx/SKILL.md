# IliaGPT Excel Spreadsheet Generation Skill

## Overview

Generate professional `.xlsx` files using the `exceljs` npm library. All code runs in the IliaGPT sandbox VM with `require("exceljs")` available. Call `saveFile(filename, buffer)` to emit the file.

## CRITICAL: Always Use Excel Formulas

**NEVER hardcode calculated values. ALWAYS use Excel formulas so the spreadsheet stays dynamic.**

```javascript
// WRONG: cell.value = data.reduce((s, r) => s + r, 0);
// CORRECT:
cell.value = { formula: "SUM(B2:B20)" };
```

This applies to ALL calculations: totals, averages, percentages, growth rates, differences.

---

## ExcelJS API Reference

```javascript
const ExcelJS = require("exceljs");
const wb = new ExcelJS.Workbook();
wb.creator = "IliaGPT";
wb.created = new Date();
const ws = wb.addWorksheet("Sheet Name");

// Columns
ws.columns = [
  { header: "Product", key: "product", width: 25 },
  { header: "Revenue", key: "rev", width: 15 },
];

// Rows
ws.addRow({ product: "Widget A", rev: 15000 });
ws.addRows([{ product: "B", rev: 22000 }, { product: "C", rev: 9000 }]);

// Direct cell access
ws.getCell("A1").value = "Title";
ws.getCell("D2").value = { formula: "B2+C2" };

// Styling
const cell = ws.getCell("A1");
cell.font = { bold: true, size: 14, color: { argb: "FF1F4E79" }, name: "Calibri" };
cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E79" } };
cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
cell.border = { top: B, bottom: B, left: B, right: B }; // B = border side object
cell.numFmt = "$#,##0.00";
```

---

## Color Coding Standards

| Text Color | Meaning | ARGB | Use When |
|-----------|---------|------|----------|
| Blue | Hardcoded inputs | `FF0000FF` | Numbers users will change |
| Black | Formulas | `FF000000` | All calculations |
| Green | Cross-sheet refs | `FF008000` | Pulling from other sheets |

| Background | Meaning | ARGB |
|-----------|---------|------|
| Header blue `#1F4E79` | Column headers | `FF1F4E79` |
| Alt row gray `#F2F2F2` | Even data rows | `FFF2F2F2` |
| Yellow | Key assumptions | `FFFFFF00` |

---

## IliaGPT Standard Styling

Every spreadsheet reuses these constants and helpers:

```javascript
const BLUE = "1F4E79", ALT_GRAY = "F2F2F2";
const BORDER = {
  top: { style: "thin", color: { argb: "FFCCCCCC" } },
  bottom: { style: "thin", color: { argb: "FFCCCCCC" } },
  left: { style: "thin", color: { argb: "FFCCCCCC" } },
  right: { style: "thin", color: { argb: "FFCCCCCC" } },
};

function styleHeaders(ws, row, count) {
  ws.getRow(row).height = 22;
  for (let c = 1; c <= count; c++) {
    const cell = ws.getRow(row).getCell(c);
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11, name: "Calibri" };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${BLUE}` } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.border = BORDER;
  }
}

function styleData(ws, start, end, count) {
  for (let r = start; r <= end; r++)
    for (let c = 1; c <= count; c++) {
      const cell = ws.getRow(r).getCell(c);
      cell.font = { size: 11, name: "Calibri" };
      cell.border = BORDER;
      if ((r - start) % 2 === 1)
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${ALT_GRAY}` } };
    }
}
```

### Title Row

```javascript
ws.mergeCells(1, 1, 1, colCount);
ws.getCell("A1").value = "Report Title";
ws.getCell("A1").font = { size: 16, bold: true, color: { argb: "FF1F4E79" }, name: "Calibri" };
ws.getCell("A1").alignment = { horizontal: "center", vertical: "middle" };
ws.getRow(1).height = 30;
```

### Frozen Panes, Auto-Filter, Auto-Width

```javascript
ws.views = [{ state: "frozen", ySplit: headerRowNum, xSplit: 0 }];
ws.autoFilter = { from: { row: headerRowNum, column: 1 }, to: { row: headerRowNum, column: colCount } };
headers.forEach((h, i) => {
  ws.getColumn(i + 1).width = Math.min(Math.max(Math.round(h.length * 1.3), 10), 40);
});
```

### Number Formats

| Type | Format | Example |
|------|--------|---------|
| Currency | `$#,##0.00` | $1,234.56 |
| Currency (int) | `$#,##0` | $1,235 |
| Percentage | `0.0%` | 12.5% |
| Thousands | `#,##0` | 1,234 |
| Accounting | `$#,##0.00;($#,##0.00);"-"` | ($500.00) |
| Date | `MM/DD/YYYY` | 04/07/2026 |
| Multiples | `0.0"x"` | 3.5x |
| Year | `0` | 2026 |

### Conditional Formatting & Data Validation

```javascript
// Highlight cells above threshold
ws.addConditionalFormatting({
  ref: "B2:B20",
  rules: [{ type: "cellIs", operator: "greaterThan", priority: 1, formulae: [10000],
    style: { font: { color: { argb: "FF008000" } } } }],
});

// Dropdown list
ws.getCell("C2").dataValidation = {
  type: "list", allowBlank: true,
  formulae: ['"Active,Inactive,Pending"'],
};
```

### Common Formulas

```javascript
cell.value = { formula: "SUM(B2:B20)" };           // Total
cell.value = { formula: "AVERAGE(B2:B20)" };        // Average
cell.value = { formula: "B2/B$21" };                // % of total
cell.value = { formula: "(C2-B2)/B2" };             // Growth rate
cell.value = { formula: 'IF(B2>10000,"High","Low")' }; // Conditional
cell.value = { formula: "VLOOKUP(A2,Sheet2!A:C,3,FALSE)" }; // Lookup
cell.value = { formula: 'SUMIF(D2:D20,"Active",B2:B20)' };  // Conditional sum
cell.value = { formula: "Summary!B10" };            // Cross-sheet ref
```

---

## Saving the File

```javascript
const buf = await wb.xlsx.writeBuffer();
saveFile("report_name.xlsx", Buffer.from(buf));
```

---

## Template 1: Sales Report

```javascript
const ExcelJS = require("exceljs");
const wb = new ExcelJS.Workbook();
wb.creator = "IliaGPT";
const BLUE = "1F4E79", ALT = "F2F2F2";
const B = { top: {style:"thin",color:{argb:"FFCCCCCC"}}, bottom: {style:"thin",color:{argb:"FFCCCCCC"}},
  left: {style:"thin",color:{argb:"FFCCCCCC"}}, right: {style:"thin",color:{argb:"FFCCCCCC"}} };

const ws = wb.addWorksheet("Sales");
const hdrs = ["Product","Q1 Sales","Q2 Sales","Q3 Sales","Q4 Sales","Annual Total"];
const data = [["Widget A",15000,18000,22000,19000],["Widget B",22000,25000,28000,31000],["Widget C",9000,11000,13000,15000]];

// Title
ws.mergeCells(1,1,1,hdrs.length);
ws.getCell("A1").value = "Annual Sales Report 2026";
ws.getCell("A1").font = { size:16, bold:true, color:{argb:`FF${BLUE}`} };
ws.getCell("A1").alignment = { horizontal:"center" };

// Headers (row 3)
hdrs.forEach((h,i) => {
  const c = ws.getRow(3).getCell(i+1);
  c.value = h; c.border = B;
  c.font = { bold:true, color:{argb:"FFFFFFFF"}, size:11 };
  c.fill = { type:"pattern", pattern:"solid", fgColor:{argb:`FF${BLUE}`} };
  c.alignment = { horizontal:"center" };
});

// Data + Annual Total formula
data.forEach((row,ri) => {
  const r = ri + 4;
  row.forEach((v,ci) => {
    const c = ws.getRow(r).getCell(ci+1);
    c.value = v; c.border = B; c.font = { size:11 };
    if (ci >= 1) { c.numFmt = "$#,##0"; c.alignment = { horizontal:"right" }; }
    if (ri%2===1) c.fill = { type:"pattern", pattern:"solid", fgColor:{argb:`FF${ALT}`} };
  });
  const t = ws.getRow(r).getCell(6);
  t.value = { formula:`SUM(B${r}:E${r})` }; t.numFmt = "$#,##0"; t.font = { bold:true, size:11 }; t.border = B;
});

// Totals row with SUM formulas
const tr = data.length + 4;
ws.getRow(tr).getCell(1).value = "TOTAL";
ws.getRow(tr).getCell(1).font = { bold:true };
for (let c=2; c<=6; c++) {
  const col = String.fromCharCode(64+c), cell = ws.getRow(tr).getCell(c);
  cell.value = { formula:`SUM(${col}4:${col}${tr-1})` };
  cell.numFmt = "$#,##0"; cell.font = { bold:true };
  cell.border = { ...B, top:{style:"medium",color:{argb:`FF${BLUE}`}} };
}

hdrs.forEach((_,i) => { ws.getColumn(i+1).width = 16; });
ws.views = [{ state:"frozen", ySplit:3, xSplit:0 }];
ws.autoFilter = { from:{row:3,column:1}, to:{row:3,column:hdrs.length} };
const buf = await wb.xlsx.writeBuffer();
saveFile("annual_sales_report.xlsx", Buffer.from(buf));
```

## Template 2: Financial Model (Multi-Sheet with Assumptions)

```javascript
const ExcelJS = require("exceljs");
const wb = new ExcelJS.Workbook();
wb.creator = "IliaGPT";
const BLUE = "1F4E79";

// Assumptions sheet -- blue text = editable inputs, yellow bg = key assumptions
const asn = wb.addWorksheet("Assumptions");
asn.getCell("A1").value = "Key Assumptions";
asn.getCell("A1").font = { bold:true, size:14, color:{argb:`FF${BLUE}`} };
[["Revenue Growth Rate",0.15],["COGS Margin",0.40],["OpEx Growth",0.05],["Tax Rate",0.25]].forEach((d,i) => {
  const r = i+3;
  asn.getCell(`A${r}`).value = d[0];
  asn.getCell(`B${r}`).value = d[1];
  asn.getCell(`B${r}`).numFmt = "0.0%";
  asn.getCell(`B${r}`).font = { color:{argb:"FF0000FF"} }; // Blue = input
  asn.getCell(`B${r}`).fill = { type:"pattern", pattern:"solid", fgColor:{argb:"FFFFFF00"} };
});
asn.columns = [{ width:25 }, { width:15 }];

// Projections sheet -- formulas reference Assumptions sheet (green text = cross-sheet)
const p = wb.addWorksheet("Projections");
["","2024A","2025E","2026E","2027E","2028E"].forEach((y,i) => {
  const c = p.getRow(2).getCell(i+1);
  c.value = y; c.font = { bold:true, color:{argb:"FFFFFFFF"} };
  c.fill = { type:"pattern", pattern:"solid", fgColor:{argb:`FF${BLUE}`} };
  c.alignment = { horizontal:"center" };
});
p.getCell("A3").value = "Revenue";
p.getCell("B3").value = 1000000; p.getCell("B3").numFmt = "$#,##0";
p.getCell("B3").font = { color:{argb:"FF0000FF"} }; // Hardcoded base year
for (let c=3; c<=6; c++) {
  const col = String.fromCharCode(64+c), prev = String.fromCharCode(63+c);
  p.getCell(`${col}3`).value = { formula:`${prev}3*(1+Assumptions!B3)` };
  p.getCell(`${col}3`).numFmt = "$#,##0";
  p.getCell(`${col}3`).font = { color:{argb:"FF008000"} }; // Green = cross-sheet
}
p.getCell("A4").value = "COGS";
p.getCell("A5").value = "Gross Profit";
for (let c=2; c<=6; c++) {
  const col = String.fromCharCode(64+c);
  p.getCell(`${col}4`).value = { formula:`-${col}3*Assumptions!B4` }; p.getCell(`${col}4`).numFmt = "$#,##0";
  p.getCell(`${col}5`).value = { formula:`${col}3+${col}4` }; p.getCell(`${col}5`).numFmt = "$#,##0";
  p.getCell(`${col}5`).font = { bold:true };
}
p.columns = [{ width:20 },{ width:14 },{ width:14 },{ width:14 },{ width:14 },{ width:14 }];
const buf = await wb.xlsx.writeBuffer();
saveFile("financial_model.xlsx", Buffer.from(buf));
```

## Template 3: Inventory Tracker (Formulas + Conditional Formatting + Dropdowns)

```javascript
const ExcelJS = require("exceljs");
const wb = new ExcelJS.Workbook();
wb.creator = "IliaGPT";
const BLUE = "1F4E79", ALT = "F2F2F2";
const B = { top:{style:"thin",color:{argb:"FFCCCCCC"}}, bottom:{style:"thin",color:{argb:"FFCCCCCC"}},
  left:{style:"thin",color:{argb:"FFCCCCCC"}}, right:{style:"thin",color:{argb:"FFCCCCCC"}} };

const ws = wb.addWorksheet("Inventory");
const hdrs = ["SKU","Product","Category","Qty","Reorder Lvl","Unit Cost","Total Value","Status"];
ws.mergeCells(1,1,1,hdrs.length);
ws.getCell("A1").value = "Inventory Tracker";
ws.getCell("A1").font = { size:16, bold:true, color:{argb:`FF${BLUE}`} };
ws.getCell("A1").alignment = { horizontal:"center" };

hdrs.forEach((h,i) => {
  const c = ws.getRow(3).getCell(i+1);
  c.value = h; c.border = B;
  c.font = { bold:true, color:{argb:"FFFFFFFF"}, size:11 };
  c.fill = { type:"pattern", pattern:"solid", fgColor:{argb:`FF${BLUE}`} };
  c.alignment = { horizontal:"center" };
});

const items = [["SKU-001","Laptop Stand","Accessories",150,50,24.99],
  ["SKU-002","USB-C Hub","Electronics",30,40,35.50],
  ["SKU-003","Wireless Mouse","Peripherals",200,75,18.99]];

items.forEach((row,ri) => {
  const r = ri+4;
  row.forEach((v,ci) => { const c = ws.getRow(r).getCell(ci+1); c.value = v; c.border = B; c.font = {size:11};
    if (ri%2===1) c.fill = { type:"pattern", pattern:"solid", fgColor:{argb:`FF${ALT}`} }; });
  ws.getCell(`F${r}`).numFmt = "$#,##0.00";
  ws.getCell(`G${r}`).value = { formula:`D${r}*F${r}` }; // Total Value = Qty * Cost
  ws.getCell(`G${r}`).numFmt = "$#,##0.00";
  ws.getCell(`H${r}`).value = { formula:`IF(D${r}<E${r},"REORDER","OK")` }; // Auto-status
});

// Red text for REORDER status
ws.addConditionalFormatting({ ref:"H4:H100",
  rules:[{ type:"cellIs", operator:"equal", priority:1, formulae:['"REORDER"'],
    style:{ font:{ color:{argb:"FFFF0000"}, bold:true } } }] });

// Category dropdown
for (let r=4; r<=100; r++)
  ws.getCell(`C${r}`).dataValidation = { type:"list", allowBlank:true,
    formulae:['"Accessories,Electronics,Peripherals,Software"'] };

[12,22,15,12,12,12,14,12].forEach((w,i) => { ws.getColumn(i+1).width = w; });
ws.views = [{ state:"frozen", ySplit:3, xSplit:0 }];
ws.autoFilter = { from:{row:3,column:1}, to:{row:3,column:hdrs.length} };
const buf = await wb.xlsx.writeBuffer();
saveFile("inventory_tracker.xlsx", Buffer.from(buf));
```

## Template 4: Project Timeline (Dates + Data Bars)

```javascript
const ExcelJS = require("exceljs");
const wb = new ExcelJS.Workbook();
wb.creator = "IliaGPT";
const BLUE = "1F4E79";
const B = { top:{style:"thin",color:{argb:"FFCCCCCC"}}, bottom:{style:"thin",color:{argb:"FFCCCCCC"}},
  left:{style:"thin",color:{argb:"FFCCCCCC"}}, right:{style:"thin",color:{argb:"FFCCCCCC"}} };

const ws = wb.addWorksheet("Timeline");
const hdrs = ["Task","Owner","Start","End","Duration","Status","% Done"];
ws.mergeCells(1,1,1,hdrs.length);
ws.getCell("A1").value = "Project Timeline";
ws.getCell("A1").font = { size:16, bold:true, color:{argb:`FF${BLUE}`} };
ws.getCell("A1").alignment = { horizontal:"center" };

hdrs.forEach((h,i) => {
  const c = ws.getRow(3).getCell(i+1);
  c.value = h; c.border = B;
  c.font = { bold:true, color:{argb:"FFFFFFFF"} };
  c.fill = { type:"pattern", pattern:"solid", fgColor:{argb:`FF${BLUE}`} };
  c.alignment = { horizontal:"center" };
});

const tasks = [
  ["Requirements","Alice","2026-04-07","2026-04-18","Complete",1.0],
  ["UI Design","Bob","2026-04-21","2026-05-02","In Progress",0.6],
  ["Backend Dev","Charlie","2026-04-28","2026-05-23","Not Started",0],
  ["Testing","Diana","2026-05-26","2026-06-06","Not Started",0],
];

tasks.forEach((t,ri) => {
  const r = ri+4;
  ws.getRow(r).getCell(1).value = t[0]; ws.getRow(r).getCell(2).value = t[1];
  ws.getCell(`C${r}`).value = new Date(t[2]); ws.getCell(`C${r}`).numFmt = "MM/DD/YYYY";
  ws.getCell(`D${r}`).value = new Date(t[3]); ws.getCell(`D${r}`).numFmt = "MM/DD/YYYY";
  ws.getCell(`E${r}`).value = { formula:`D${r}-C${r}` }; ws.getCell(`E${r}`).numFmt = "0"; // Duration formula
  ws.getCell(`F${r}`).value = t[4];
  ws.getCell(`G${r}`).value = t[5]; ws.getCell(`G${r}`).numFmt = "0%";
  for (let c=1; c<=7; c++) ws.getRow(r).getCell(c).border = B;
});

// Status dropdown + conditional formatting
for (let r=4; r<=20; r++)
  ws.getCell(`F${r}`).dataValidation = { type:"list", allowBlank:true,
    formulae:['"Not Started,In Progress,Complete,Blocked"'] };
ws.addConditionalFormatting({ ref:"F4:F20", rules:[
  { type:"cellIs", operator:"equal", priority:1, formulae:['"Complete"'],
    style:{ font:{color:{argb:"FF008000"}} } },
  { type:"cellIs", operator:"equal", priority:2, formulae:['"Blocked"'],
    style:{ font:{color:{argb:"FFFF0000"}} } },
]});
ws.addConditionalFormatting({ ref:"G4:G20",
  rules:[{ type:"dataBar", priority:3, minLength:0, maxLength:100 }] });

[28,14,14,14,12,14,12].forEach((w,i) => { ws.getColumn(i+1).width = w; });
ws.views = [{ state:"frozen", ySplit:3, xSplit:0 }];
ws.autoFilter = { from:{row:3,column:1}, to:{row:3,column:hdrs.length} };
const buf = await wb.xlsx.writeBuffer();
saveFile("project_timeline.xlsx", Buffer.from(buf));
```

---

## Critical Rules

1. **ALWAYS use Excel formulas** -- never compute in JS and hardcode results.
2. **Color code inputs vs formulas** -- blue text for inputs, black for formulas, green for cross-sheet.
3. **Always freeze header row** -- `ws.views = [{ state: "frozen", ySplit: N }]`.
4. **Always add auto-filter** -- enables sorting and filtering.
5. **Use number formats** -- `$#,##0.00` for currency, `0.0%` for percentages, `#,##0` for numbers.
6. **Alternating row colors** -- `#F2F2F2` gray on every other data row.
7. **Blue header bar** -- `#1F4E79` with white text.
8. **Auto-width columns** -- min 10, max 40.
9. **Workbook metadata** -- `wb.creator = "IliaGPT"`, `wb.created = new Date()`.
10. **Always call `saveFile()`** -- `saveFile("name.xlsx", Buffer.from(await wb.xlsx.writeBuffer()))`.
