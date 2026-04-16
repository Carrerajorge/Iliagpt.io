# Spreadsheet Analyzer - ChatGPT Parity Checklist

## Demo File
Use `/tmp/spreadsheets/demo_sales_data.csv` to validate all features.

The demo contains 20 products across 5 categories (Electronics, Furniture, Appliances, Sports, Health) with:
- Sales data (Q1-Q4)
- Pricing and revenue info
- Regional distribution (North America, Europe, Asia Pacific)

---

## Upload Experience

| Feature | ChatGPT | Sira GPT | Status |
|---------|---------|----------|--------|
| Drag-drop upload | ✓ | ✓ | ✅ |
| File validation (xlsx/xls/csv) | ✓ | ✓ | ✅ |
| File size limit (25MB) | ✓ | ✓ | ✅ |
| Immediate preview after upload | ✓ | ✓ | ✅ |
| Auto-select first sheet | ✓ | ✓ | ✅ |
| Sheet list with row/column counts | ✓ | ✓ | ✅ |

---

## Data Viewer

| Feature | ChatGPT | Sira GPT | Status |
|---------|---------|----------|--------|
| Interactive table view | ✓ | ✓ | ✅ |
| Smooth virtualized scroll | ✓ | ✓ | ✅ |
| Column type icons (text/number/date) | ✓ | ✓ | ✅ |
| Sticky header row | ✓ | ✓ | ✅ |
| Column filters | ✓ | ✓ | ✅ |
| Sheet dropdown selector | ✓ | ✓ | ✅ |
| No pagination (single scroll) | ✓ | ✓ | ✅ |

---

## AI Analysis

| Feature | ChatGPT | Sira GPT | Status |
|---------|---------|----------|--------|
| Analysis mode selection | ✓ | ✓ | ✅ |
| Custom prompt input | ✓ | ✓ | ✅ |
| Status indicator (generating/executing) | ✓ | ✓ | ✅ |
| Progress polling | ✓ | ✓ | ✅ |

---

## Code Generation

| Feature | ChatGPT | Sira GPT | Status |
|---------|---------|----------|--------|
| pd.ExcelFile() usage | ✓ | ✓ | ✅ |
| sheet_names exploration | ✓ | ✓ | ✅ |
| pd.read_excel with sheet_name | ✓ | ✓ | ✅ |
| Readable, commented code | ✓ | ✓ | ✅ |
| Collapsible code block | ✓ | ✓ | ✅ |
| Copy code button | ✓ | ✓ | ✅ |

---

## Results Display

| Feature | ChatGPT | Sira GPT | Status |
|---------|---------|----------|--------|
| Summary text | ✓ | ✓ | ✅ |
| Key metrics cards | ✓ | ✓ | ✅ |
| Data tables with headers | ✓ | ✓ | ✅ |
| Charts placeholder | ✓ | ✓ (placeholder) | ⚠️ |
| Execution logs | - | ✓ | ✅ |

---

## Security

| Feature | Sira GPT | Status |
|---------|----------|--------|
| AST-based code validation | ✓ | ✅ |
| Blocked modules (os, subprocess, eval, exec) | ✓ | ✅ |
| Resource limits (512MB RAM, 60s timeout) | ✓ | ✅ |
| Allowed modules only (pandas, numpy, json, datetime, math) | ✓ | ✅ |

---

## Known Limitations

1. **Charts**: Currently shows placeholder. Full chart rendering with Recharts needs implementation.
2. **Python Sandbox**: Uses process-level isolation. For production, consider adding:
   - Filesystem isolation (chroot/container)
   - Runtime import whitelist enforcement
   - Dedicated user/namespace

---

## Test Scenarios

### 1. Basic Upload Test
1. Navigate to `/spreadsheet-analyzer`
2. Upload `demo_sales_data.csv`
3. Verify: Table shows immediately with 20 rows, 11 columns
4. Verify: Filters work on Product and Category columns

### 2. Analysis Test
1. After upload, go to "AI Analysis" tab
2. Select "Full Analysis" mode
3. Click "Analyze Sheet"
4. Verify: Status shows "Generating Code" → "Executing" → "Complete"
5. Verify: Summary, Metrics, and Data Tables appear

### 3. Custom Prompt Test
1. Enter prompt: "Find the top 5 products by Revenue"
2. Click "Analyze Sheet"
3. Verify: Results focus on revenue analysis

### 4. Code Review Test
1. After analysis completes, click "Generated Code"
2. Verify: Code uses pd.ExcelFile pattern
3. Verify: Code has register_table and register_metric helpers
4. Verify: Copy button works
