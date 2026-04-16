# PPTX Skill -- IliaGPT Presentation Generator

This skill is injected into the system prompt when a user requests a PowerPoint presentation. Follow these instructions exactly.

---

## Decision Tree

| Situation | Approach |
|-----------|----------|
| Create a new presentation from scratch | Use **PptxGenJS** (Node.js). See API Reference below. |
| Edit/modify an existing .pptx file | Use **OOXML direct manipulation**: unzip, edit XML, rezip. |
| Extract text from a .pptx | Parse the XML inside the zip archive. |

For IliaGPT, the vast majority of requests are **create from scratch**. Default to PptxGenJS unless the user explicitly provides an existing file to edit.

---

## Setup & Boilerplate

```javascript
const pptxgen = require("pptxgenjs");

let pres = new pptxgen();
pres.layout = "LAYOUT_16x9"; // 10" x 5.625"
pres.author = "IliaGPT";
pres.title = "Presentation Title";

// ... add slides ...

// REQUIRED: save via buffer + saveFile()
const buffer = await pres.write({ outputType: "nodebuffer" });
saveFile("presentation.pptx", buffer);
```

**Always end every script with `saveFile("filename.pptx", buffer)`**. This is how IliaGPT delivers the file to the user.

---

## Layout Dimensions

All coordinates are in inches.

| Layout | Width | Height |
|--------|-------|--------|
| `LAYOUT_16x9` | 10" | 5.625" |
| `LAYOUT_16x10` | 10" | 6.25" |
| `LAYOUT_4x3` | 10" | 7.5" |
| `LAYOUT_WIDE` | 13.3" | 7.5" |

Default: `LAYOUT_16x9` (10 x 5.625).

---

## Design Rules

### Typography

| Element | Size | Style |
|---------|------|-------|
| Slide title | 36-44pt | Bold |
| Section header | 20-24pt | Bold |
| Body text | 14-16pt | Regular |
| Captions / footnotes | 10-12pt | Muted color |

**Font pairings** (header / body):

| Header | Body |
|--------|------|
| Georgia | Calibri |
| Arial Black | Arial |
| Calibri | Calibri Light |
| Cambria | Calibri |
| Trebuchet MS | Calibri |
| Palatino | Garamond |

### Spacing

- **0.5" minimum margins** from slide edges.
- **0.3-0.5"** between content blocks.
- Leave breathing room. Do not fill every inch of the slide.

### Color Palettes

Pick a palette that matches the topic. Do not default to generic blue.

| Theme | Primary | Secondary | Accent |
|-------|---------|-----------|--------|
| **Midnight Executive** | `1E2761` (navy) | `CADCFC` (ice blue) | `FFFFFF` (white) |
| **Forest & Moss** | `2C5F2D` (forest) | `97BC62` (moss) | `F5F5F5` (cream) |
| **Coral Energy** | `F96167` (coral) | `F9E795` (gold) | `2F3C7E` (navy) |
| **Warm Terracotta** | `B85042` (terracotta) | `E7E8D1` (sand) | `A7BEAE` (sage) |
| **Ocean Gradient** | `065A82` (deep blue) | `1C7293` (teal) | `21295C` (midnight) |
| **Charcoal Minimal** | `36454F` (charcoal) | `F2F2F2` (off-white) | `212121` (black) |
| **Teal Trust** | `028090` (teal) | `00A896` (seafoam) | `02C39A` (mint) |
| **Berry & Cream** | `6D2E46` (berry) | `A26769` (dusty rose) | `ECE2D0` (cream) |
| **Sage Calm** | `84B59F` (sage) | `69A297` (eucalyptus) | `50808E` (slate) |
| **Cherry Bold** | `990011` (cherry) | `FCF6F5` (off-white) | `2F3C7E` (navy) |

### Visual Principles

- **Dominance over equality**: One color should dominate (60-70%), with 1-2 supporting tones and one sharp accent.
- **Dark/light contrast**: Dark backgrounds for title + conclusion slides, light for content slides (sandwich structure).
- **Commit to a visual motif**: Pick ONE distinctive element and repeat it across every slide (e.g., colored circles for icons, thick side borders on cards).
- **Every slide needs a visual element**: image, chart, icon, or shape. Never produce text-only slides.

### Layout Ideas Per Slide

- Two-column: text left, illustration right.
- Icon + text rows: icon in colored circle, bold header, description below.
- 2x2 or 2x3 grid of content blocks.
- Large stat callout: big number (60-72pt) with small label below.
- Comparison columns: before/after, pros/cons.
- Timeline or process flow with numbered steps.

### Anti-Patterns (Never Do These)

- Do NOT repeat the same layout on every slide. Vary columns, cards, and callouts.
- Do NOT center body text. Left-align paragraphs and lists; center only titles.
- Do NOT use weak size contrast. Titles need 36pt+ to stand out from 14-16pt body.
- Do NOT default to blue without reason. Pick colors that reflect the topic.
- Do NOT mix spacing randomly. Choose 0.3" or 0.5" gaps and use them consistently.
- Do NOT use lorem ipsum or placeholder text. All content must be real.
- Do NOT create text-only slides. Add images, icons, charts, or visual elements.
- Do NOT use accent lines under titles. These look like AI-generated slides. Use whitespace or background color.
- Do NOT forget text box padding. Set `margin: 0` when aligning text edges with shapes.
- Do NOT use low-contrast elements. Ensure strong contrast for both icons and text against backgrounds.

---

## PptxGenJS API Reference

### Adding Text

```javascript
// Basic text box
slide.addText("Hello", {
  x: 0.5, y: 0.5, w: 9, h: 1,
  fontSize: 36, fontFace: "Arial", color: "363636",
  bold: true, align: "center", valign: "middle"
});

// Rich text (mixed formatting)
slide.addText([
  { text: "Bold part ", options: { bold: true } },
  { text: "and italic", options: { italic: true } }
], { x: 0.5, y: 2, w: 9, h: 1 });

// Multi-line (requires breakLine: true)
slide.addText([
  { text: "Line 1", options: { breakLine: true } },
  { text: "Line 2", options: { breakLine: true } },
  { text: "Line 3" }
], { x: 0.5, y: 0.5, w: 8, h: 2 });

// Character spacing
slide.addText("SPACED", { x: 1, y: 1, w: 8, h: 1, charSpacing: 6 });
```

### Bullet Lists

```javascript
// Correct way to make bullets
slide.addText([
  { text: "First item", options: { bullet: true, breakLine: true } },
  { text: "Second item", options: { bullet: true, breakLine: true } },
  { text: "Third item", options: { bullet: true } }
], { x: 0.5, y: 1, w: 8, h: 3 });

// Sub-items
{ text: "Sub-item", options: { bullet: true, indentLevel: 1 } }

// Numbered lists
{ text: "First", options: { bullet: { type: "number" }, breakLine: true } }
```

**Never use unicode bullets like "&#8226;"**. They create double bullets.

### Shapes

```javascript
slide.addShape(pres.shapes.RECTANGLE, {
  x: 0.5, y: 0.8, w: 1.5, h: 3.0,
  fill: { color: "FF0000" },
  line: { color: "000000", width: 2 }
});

slide.addShape(pres.shapes.OVAL, {
  x: 4, y: 1, w: 2, h: 2, fill: { color: "0000FF" }
});

slide.addShape(pres.shapes.LINE, {
  x: 1, y: 3, w: 5, h: 0,
  line: { color: "CCCCCC", width: 1, dashType: "dash" }
});

// Rounded rectangle
slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
  x: 1, y: 1, w: 3, h: 2,
  fill: { color: "FFFFFF" }, rectRadius: 0.1
});

// With shadow (always use factory function, never reuse object)
const makeShadow = () => ({
  type: "outer", color: "000000", blur: 6,
  offset: 2, angle: 135, opacity: 0.15
});
slide.addShape(pres.shapes.RECTANGLE, {
  x: 1, y: 1, w: 3, h: 2,
  fill: { color: "FFFFFF" }, shadow: makeShadow()
});

// With transparency
slide.addShape(pres.shapes.RECTANGLE, {
  x: 1, y: 1, w: 3, h: 2,
  fill: { color: "0088CC", transparency: 50 }
});
```

Available shapes: `RECTANGLE`, `OVAL`, `LINE`, `ROUNDED_RECTANGLE`.

### Slide Backgrounds

```javascript
slide.background = { color: "F1F1F1" };
slide.background = { color: "FF3399", transparency: 50 };
slide.background = { path: "https://example.com/bg.jpg" };
slide.background = { data: "image/png;base64,iVBORw..." };
```

### Images

```javascript
// From file path
slide.addImage({ path: "chart.png", x: 1, y: 1, w: 5, h: 3 });

// From URL
slide.addImage({ path: "https://example.com/img.jpg", x: 1, y: 1, w: 5, h: 3 });

// From base64
slide.addImage({ data: "image/png;base64,iVBOR...", x: 1, y: 1, w: 5, h: 3 });

// Sizing modes
{ sizing: { type: "contain", w: 4, h: 3 } }  // fit, preserve ratio
{ sizing: { type: "cover", w: 4, h: 3 } }    // fill, may crop

// Rounding, rotation, transparency
{ rounding: true, rotate: 45, transparency: 50 }
```

### Tables

```javascript
// Simple table
slide.addTable([
  ["Header 1", "Header 2", "Header 3"],
  ["Row 1 A", "Row 1 B", "Row 1 C"],
  ["Row 2 A", "Row 2 B", "Row 2 C"]
], {
  x: 0.5, y: 1.5, w: 9, h: 2,
  border: { pt: 1, color: "CCCCCC" },
  fill: { color: "F9F9F9" },
  fontSize: 12, fontFace: "Calibri"
});

// Styled header row
const tableData = [
  [
    { text: "Metric", options: { fill: { color: "1E2761" }, color: "FFFFFF", bold: true } },
    { text: "Value", options: { fill: { color: "1E2761" }, color: "FFFFFF", bold: true } }
  ],
  ["Revenue", "$4.2M"],
  ["Growth", "+18%"]
];
slide.addTable(tableData, { x: 0.5, y: 1.5, w: 9, colW: [5, 4] });
```

### Charts

```javascript
// Bar chart (vertical)
slide.addChart(pres.charts.BAR, [{
  name: "Sales",
  labels: ["Q1", "Q2", "Q3", "Q4"],
  values: [4500, 5500, 6200, 7100]
}], {
  x: 0.5, y: 1, w: 9, h: 4, barDir: "col",
  showTitle: true, title: "Quarterly Sales",
  chartColors: ["0D9488", "14B8A6", "5EEAD4"],
  valGridLine: { color: "E2E8F0", size: 0.5 },
  catGridLine: { style: "none" },
  showValue: true, dataLabelPosition: "outEnd",
  showLegend: false
});

// Line chart
slide.addChart(pres.charts.LINE, [{
  name: "Users",
  labels: ["Jan", "Feb", "Mar", "Apr"],
  values: [1200, 1800, 2400, 3100]
}], {
  x: 0.5, y: 1, w: 9, h: 4,
  lineSize: 3, lineSmooth: true,
  chartColors: ["065A82"]
});

// Pie chart
slide.addChart(pres.charts.PIE, [{
  name: "Market Share",
  labels: ["Product A", "Product B", "Other"],
  values: [45, 35, 20]
}], {
  x: 3, y: 1, w: 4, h: 4,
  showPercent: true,
  chartColors: ["1E2761", "CADCFC", "F96167"]
});
```

Available chart types: `BAR`, `LINE`, `PIE`, `DOUGHNUT`, `SCATTER`, `BUBBLE`, `RADAR`.

### Slide Masters

```javascript
pres.defineSlideMaster({
  title: "TITLE_SLIDE",
  background: { color: "1E2761" },
  objects: [{
    placeholder: {
      options: { name: "title", type: "title", x: 1, y: 2, w: 8, h: 2 }
    }
  }]
});

let slide = pres.addSlide({ masterName: "TITLE_SLIDE" });
slide.addText("My Title", { placeholder: "title" });
```

---

## Common Pitfalls

These cause file corruption or visual bugs. Memorize them.

1. **Never use "#" in hex colors.** `color: "FF0000"` is correct. `color: "#FF0000"` corrupts the file.
2. **Never encode opacity in the color string.** `"00000020"` (8-char hex) corrupts the file. Use `opacity: 0.12` separately.
3. **Never use unicode bullet characters** like `"bullet "`. Use `bullet: true` in options.
4. **Always use `breakLine: true`** between text array items, or they concatenate on one line.
5. **Avoid `lineSpacing` with bullets.** Use `paraSpaceAfter` instead.
6. **Never reuse option objects across calls.** PptxGenJS mutates objects in-place (converts to EMU). Use factory functions.
7. **Each presentation needs a fresh `new pptxgen()`.** Never reuse instances.
8. **Do not pair `ROUNDED_RECTANGLE` with rectangular accent overlays.** The overlay will not cover rounded corners. Use `RECTANGLE` instead.
9. **Shadow offset must be non-negative.** Negative values corrupt the file. Use `angle: 270` for upward shadows.

---

## Code Templates

### Title Slide

```javascript
let slide = pres.addSlide();
slide.background = { color: "1E2761" };
slide.addText("Presentation Title", {
  x: 0.5, y: 1.5, w: 9, h: 1.5,
  fontSize: 44, fontFace: "Georgia", color: "FFFFFF",
  bold: true, align: "center"
});
slide.addText("Subtitle or date goes here", {
  x: 0.5, y: 3.2, w: 9, h: 0.8,
  fontSize: 18, fontFace: "Calibri", color: "CADCFC",
  align: "center"
});
```

### Content Slide (bullets)

```javascript
let slide = pres.addSlide();
slide.background = { color: "FFFFFF" };
slide.addText("Section Title", {
  x: 0.5, y: 0.3, w: 9, h: 0.8,
  fontSize: 28, fontFace: "Georgia", color: "1E2761", bold: true
});
slide.addShape(pres.shapes.RECTANGLE, {
  x: 0.5, y: 1.1, w: 9, h: 0.02, fill: { color: "CADCFC" }
});
slide.addText([
  { text: "Key insight number one with supporting detail", options: { bullet: true, breakLine: true } },
  { text: "Second point that builds on the first", options: { bullet: true, breakLine: true } },
  { text: "Final takeaway with call to action", options: { bullet: true } }
], {
  x: 0.7, y: 1.4, w: 8.5, h: 3.5,
  fontSize: 16, fontFace: "Calibri", color: "363636",
  lineSpacingMultiple: 1.5
});
```

### Two-Column Slide

```javascript
let slide = pres.addSlide();
slide.background = { color: "F5F5F5" };
slide.addText("Comparison", {
  x: 0.5, y: 0.3, w: 9, h: 0.8,
  fontSize: 28, fontFace: "Georgia", color: "1E2761", bold: true
});
// Left column
slide.addShape(pres.shapes.RECTANGLE, {
  x: 0.5, y: 1.3, w: 4.2, h: 3.5,
  fill: { color: "FFFFFF" },
  shadow: { type: "outer", color: "000000", blur: 4, offset: 2, angle: 135, opacity: 0.1 }
});
slide.addText("Option A", {
  x: 0.8, y: 1.5, w: 3.6, h: 0.5,
  fontSize: 20, fontFace: "Georgia", color: "1E2761", bold: true
});
slide.addText("Description of the first option with key benefits and details.", {
  x: 0.8, y: 2.1, w: 3.6, h: 2.2,
  fontSize: 14, fontFace: "Calibri", color: "555555"
});
// Right column
slide.addShape(pres.shapes.RECTANGLE, {
  x: 5.3, y: 1.3, w: 4.2, h: 3.5,
  fill: { color: "FFFFFF" },
  shadow: { type: "outer", color: "000000", blur: 4, offset: 2, angle: 135, opacity: 0.1 }
});
slide.addText("Option B", {
  x: 5.6, y: 1.5, w: 3.6, h: 0.5,
  fontSize: 20, fontFace: "Georgia", color: "1E2761", bold: true
});
slide.addText("Description of the second option with its own advantages.", {
  x: 5.6, y: 2.1, w: 3.6, h: 2.2,
  fontSize: 14, fontFace: "Calibri", color: "555555"
});
```

### Table Slide

```javascript
let slide = pres.addSlide();
slide.background = { color: "FFFFFF" };
slide.addText("Performance Metrics", {
  x: 0.5, y: 0.3, w: 9, h: 0.8,
  fontSize: 28, fontFace: "Georgia", color: "1E2761", bold: true
});
const rows = [
  [
    { text: "Metric", options: { fill: { color: "1E2761" }, color: "FFFFFF", bold: true, fontSize: 14 } },
    { text: "Q1", options: { fill: { color: "1E2761" }, color: "FFFFFF", bold: true, fontSize: 14 } },
    { text: "Q2", options: { fill: { color: "1E2761" }, color: "FFFFFF", bold: true, fontSize: 14 } },
    { text: "Q3", options: { fill: { color: "1E2761" }, color: "FFFFFF", bold: true, fontSize: 14 } }
  ],
  ["Revenue", "$1.2M", "$1.5M", "$1.8M"],
  ["Users", "12,400", "15,800", "19,200"],
  ["NPS", "72", "76", "81"]
];
slide.addTable(rows, {
  x: 0.5, y: 1.3, w: 9, h: 3.0,
  colW: [3, 2, 2, 2],
  border: { pt: 0.5, color: "E0E0E0" },
  fontSize: 13, fontFace: "Calibri", color: "363636",
  rowH: [0.5, 0.6, 0.6, 0.6],
  align: "center"
});
```

### Chart Slide

```javascript
let slide = pres.addSlide();
slide.background = { color: "FFFFFF" };
slide.addText("Growth Trend", {
  x: 0.5, y: 0.3, w: 9, h: 0.8,
  fontSize: 28, fontFace: "Georgia", color: "1E2761", bold: true
});
slide.addChart(pres.charts.BAR, [{
  name: "Revenue ($K)",
  labels: ["Jan", "Feb", "Mar", "Apr", "May", "Jun"],
  values: [120, 145, 162, 178, 195, 220]
}], {
  x: 0.5, y: 1.2, w: 9, h: 3.8,
  barDir: "col",
  chartColors: ["1E2761"],
  catAxisLabelColor: "64748B",
  valAxisLabelColor: "64748B",
  valGridLine: { color: "E2E8F0", size: 0.5 },
  catGridLine: { style: "none" },
  showValue: true, dataLabelPosition: "outEnd", dataLabelColor: "1E293B",
  showLegend: false
});
```

---

## Quality Checklist

Before delivering any presentation:

1. No lorem ipsum or placeholder text anywhere.
2. All hex colors are 6 characters, no `#` prefix.
3. Every text array item uses `breakLine: true` except the last.
4. Shadow/style objects are created fresh for each call (factory functions).
5. Margins are at least 0.5" from slide edges.
6. Title slides use dark background; content slides use light background.
7. Font sizes follow the hierarchy: title 36-44pt, section 20-24pt, body 14-16pt.
8. At least 2 different layout types are used across slides.
9. The script ends with `saveFile("filename.pptx", buffer)`.
10. File name is descriptive and uses kebab-case (e.g., `quarterly-report-2026.pptx`).
