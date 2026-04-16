# PPTX Templates -- Complete Working Scripts

Each template below is a self-contained PptxGenJS script. Copy and adapt as needed.

---

## 1. Corporate Presentation (Midnight Executive -- Blue Theme)

```javascript
const pptxgen = require("pptxgenjs");
let pres = new pptxgen();
pres.layout = "LAYOUT_16x9";
pres.author = "IliaGPT";
pres.title = "Corporate Overview";

const PRIMARY = "1E2761";
const SECONDARY = "CADCFC";
const WHITE = "FFFFFF";
const BODY = "363636";

// -- Slide 1: Title
let s1 = pres.addSlide();
s1.background = { color: PRIMARY };
s1.addText("Corporate Strategy 2026", {
  x: 0.5, y: 1.2, w: 9, h: 1.5, fontSize: 44, fontFace: "Georgia",
  color: WHITE, bold: true, align: "center"
});
s1.addText("Annual Planning & Executive Summary", {
  x: 0.5, y: 3.0, w: 9, h: 0.8, fontSize: 18, fontFace: "Calibri",
  color: SECONDARY, align: "center"
});
s1.addText("April 2026  |  Confidential", {
  x: 0.5, y: 4.5, w: 9, h: 0.5, fontSize: 12, fontFace: "Calibri",
  color: SECONDARY, align: "center"
});

// -- Slide 2: Key Metrics
let s2 = pres.addSlide();
s2.background = { color: WHITE };
s2.addText("Key Performance Indicators", {
  x: 0.5, y: 0.3, w: 9, h: 0.8, fontSize: 28, fontFace: "Georgia",
  color: PRIMARY, bold: true
});
const metrics = [
  { label: "Revenue", value: "$42M", delta: "+18% YoY" },
  { label: "Customers", value: "1,240", delta: "+32% YoY" },
  { label: "NPS Score", value: "78", delta: "+6 pts" }
];
metrics.forEach((m, i) => {
  const x = 0.5 + i * 3.1;
  s2.addShape(pres.shapes.RECTANGLE, {
    x, y: 1.4, w: 2.8, h: 3.2, fill: { color: "F8F9FC" }
  });
  s2.addText(m.value, {
    x, y: 1.8, w: 2.8, h: 1.2, fontSize: 48, fontFace: "Georgia",
    color: PRIMARY, bold: true, align: "center"
  });
  s2.addText(m.label, {
    x, y: 3.0, w: 2.8, h: 0.5, fontSize: 16, fontFace: "Calibri",
    color: BODY, align: "center"
  });
  s2.addText(m.delta, {
    x, y: 3.5, w: 2.8, h: 0.5, fontSize: 14, fontFace: "Calibri",
    color: "2C7A3E", align: "center"
  });
});

// -- Slide 3: Strategic Priorities
let s3 = pres.addSlide();
s3.background = { color: WHITE };
s3.addText("Strategic Priorities", {
  x: 0.5, y: 0.3, w: 9, h: 0.8, fontSize: 28, fontFace: "Georgia",
  color: PRIMARY, bold: true
});
const priorities = [
  "Expand into three new international markets by Q3",
  "Launch enterprise tier with dedicated support",
  "Reduce customer churn from 4.2% to under 2.5%",
  "Complete SOC 2 Type II certification"
];
s3.addText(
  priorities.map((p, i) => ({
    text: p,
    options: { bullet: true, breakLine: i < priorities.length - 1 }
  })),
  { x: 0.7, y: 1.4, w: 8.5, h: 3.5, fontSize: 16, fontFace: "Calibri",
    color: BODY, lineSpacingMultiple: 1.8 }
);

// -- Slide 4: Closing
let s4 = pres.addSlide();
s4.background = { color: PRIMARY };
s4.addText("Thank You", {
  x: 0.5, y: 1.8, w: 9, h: 1.5, fontSize: 44, fontFace: "Georgia",
  color: WHITE, bold: true, align: "center"
});
s4.addText("Questions & Discussion", {
  x: 0.5, y: 3.5, w: 9, h: 0.8, fontSize: 18, fontFace: "Calibri",
  color: SECONDARY, align: "center"
});

const buffer = await pres.write({ outputType: "nodebuffer" });
saveFile("corporate-strategy-2026.pptx", buffer);
```

---

## 2. Sales Report (Forest & Moss -- Green/Money Theme)

```javascript
const pptxgen = require("pptxgenjs");
let pres = new pptxgen();
pres.layout = "LAYOUT_16x9";
pres.author = "IliaGPT";
pres.title = "Sales Report";

const PRIMARY = "2C5F2D";
const MOSS = "97BC62";
const CREAM = "F5F5F5";
const BODY = "333333";

// -- Slide 1: Title
let s1 = pres.addSlide();
s1.background = { color: PRIMARY };
s1.addText("Q1 2026 Sales Report", {
  x: 0.5, y: 1.5, w: 9, h: 1.2, fontSize: 42, fontFace: "Trebuchet MS",
  color: "FFFFFF", bold: true, align: "center"
});
s1.addText("North America Region  |  Prepared for Leadership", {
  x: 0.5, y: 3.0, w: 9, h: 0.7, fontSize: 16, fontFace: "Calibri",
  color: MOSS, align: "center"
});

// -- Slide 2: Revenue Chart
let s2 = pres.addSlide();
s2.background = { color: CREAM };
s2.addText("Monthly Revenue", {
  x: 0.5, y: 0.3, w: 9, h: 0.8, fontSize: 28, fontFace: "Trebuchet MS",
  color: PRIMARY, bold: true
});
s2.addChart(pres.charts.BAR, [{
  name: "Revenue ($K)",
  labels: ["Jan", "Feb", "Mar"],
  values: [320, 385, 410]
}], {
  x: 0.5, y: 1.2, w: 9, h: 3.8, barDir: "col",
  chartColors: [PRIMARY, MOSS, "78A844"],
  valGridLine: { color: "DDDDDD", size: 0.5 },
  catGridLine: { style: "none" },
  showValue: true, dataLabelPosition: "outEnd", dataLabelColor: BODY,
  showLegend: false, catAxisLabelColor: "666666", valAxisLabelColor: "666666"
});

// -- Slide 3: Top Deals Table
let s3 = pres.addSlide();
s3.background = { color: "FFFFFF" };
s3.addText("Top Closed Deals", {
  x: 0.5, y: 0.3, w: 9, h: 0.8, fontSize: 28, fontFace: "Trebuchet MS",
  color: PRIMARY, bold: true
});
const mkH = (t) => ({ text: t, options: { fill: { color: PRIMARY }, color: "FFFFFF", bold: true, fontSize: 13 } });
s3.addTable([
  [mkH("Account"), mkH("Value"), mkH("Rep"), mkH("Close Date")],
  ["Acme Corp", "$185,000", "Sarah Chen", "Feb 14"],
  ["GlobalTech", "$142,000", "James Miller", "Mar 2"],
  ["Summit Health", "$98,500", "Maria Lopez", "Mar 18"]
], {
  x: 0.5, y: 1.3, w: 9, h: 2.8, colW: [3, 2, 2, 2],
  border: { pt: 0.5, color: "DDDDDD" }, fontSize: 13, fontFace: "Calibri",
  color: BODY, align: "center"
});

// -- Slide 4: Next Quarter Targets
let s4 = pres.addSlide();
s4.background = { color: PRIMARY };
s4.addText("Q2 Targets", {
  x: 0.5, y: 1.0, w: 9, h: 1.0, fontSize: 36, fontFace: "Trebuchet MS",
  color: "FFFFFF", bold: true, align: "center"
});
const targets = ["Pipeline target: $2.4M", "Close rate goal: 28%", "New logos: 15 accounts", "Expand 8 existing accounts"];
s4.addText(
  targets.map((t, i) => ({
    text: t,
    options: { bullet: true, breakLine: i < targets.length - 1, color: MOSS }
  })),
  { x: 2.5, y: 2.3, w: 5, h: 2.8, fontSize: 18, fontFace: "Calibri" }
);

const buffer = await pres.write({ outputType: "nodebuffer" });
saveFile("q1-2026-sales-report.pptx", buffer);
```

---

## 3. Technical Architecture (Ocean Gradient -- Dark Theme)

```javascript
const pptxgen = require("pptxgenjs");
let pres = new pptxgen();
pres.layout = "LAYOUT_16x9";
pres.author = "IliaGPT";
pres.title = "System Architecture";

const DEEP = "21295C";
const BLUE = "065A82";
const TEAL = "1C7293";
const LIGHT = "E8EEF2";
const WHITE = "FFFFFF";

// -- Slide 1: Title
let s1 = pres.addSlide();
s1.background = { color: DEEP };
s1.addText("System Architecture", {
  x: 0.5, y: 1.5, w: 9, h: 1.2, fontSize: 44, fontFace: "Consolas",
  color: WHITE, bold: true, align: "center"
});
s1.addText("Platform v3.0 -- Infrastructure Overview", {
  x: 0.5, y: 3.0, w: 9, h: 0.7, fontSize: 16, fontFace: "Calibri",
  color: TEAL, align: "center"
});

// -- Slide 2: Architecture Layers (3-row stack)
let s2 = pres.addSlide();
s2.background = { color: DEEP };
s2.addText("Architecture Layers", {
  x: 0.5, y: 0.3, w: 9, h: 0.7, fontSize: 24, fontFace: "Consolas",
  color: WHITE, bold: true
});
const layers = [
  { name: "Presentation Layer", desc: "React SPA, CDN, Edge Cache", color: TEAL },
  { name: "Application Layer", desc: "Node.js API, Auth, Rate Limiting", color: BLUE },
  { name: "Data Layer", desc: "PostgreSQL, Redis, S3 Object Store", color: "0A3D5C" }
];
layers.forEach((l, i) => {
  const y = 1.2 + i * 1.4;
  s2.addShape(pres.shapes.RECTANGLE, {
    x: 1.0, y, w: 8.0, h: 1.1, fill: { color: l.color }
  });
  s2.addText(l.name, {
    x: 1.3, y, w: 3.5, h: 1.1, fontSize: 18, fontFace: "Consolas",
    color: WHITE, bold: true, valign: "middle", margin: 0
  });
  s2.addText(l.desc, {
    x: 5.0, y, w: 3.8, h: 1.1, fontSize: 14, fontFace: "Calibri",
    color: LIGHT, valign: "middle", align: "right", margin: 0
  });
});

// -- Slide 3: Tech Stack Table
let s3 = pres.addSlide();
s3.background = { color: "0F172A" };
s3.addText("Technology Stack", {
  x: 0.5, y: 0.3, w: 9, h: 0.7, fontSize: 24, fontFace: "Consolas",
  color: WHITE, bold: true
});
const mkTH = (t) => ({ text: t, options: { fill: { color: BLUE }, color: WHITE, bold: true, fontSize: 13 } });
s3.addTable([
  [mkTH("Component"), mkTH("Technology"), mkTH("Purpose")],
  ["Frontend", "React 19 + Vite", "Single-page application"],
  ["API", "Express.js + Node 22", "REST + WebSocket gateway"],
  ["Database", "PostgreSQL 16 + pgvector", "Relational + vector search"],
  ["Cache", "Redis 7", "Sessions, pub/sub, rate limiting"],
  ["Infra", "Docker + Kubernetes", "Container orchestration"]
], {
  x: 0.5, y: 1.2, w: 9, h: 3.5, colW: [2.5, 3.5, 3],
  border: { pt: 0.5, color: "334155" }, fontSize: 12, fontFace: "Calibri",
  color: LIGHT, align: "left"
});

// -- Slide 4: Closing
let s4 = pres.addSlide();
s4.background = { color: DEEP };
s4.addText("Questions?", {
  x: 0.5, y: 2.0, w: 9, h: 1.2, fontSize: 44, fontFace: "Consolas",
  color: WHITE, bold: true, align: "center"
});
s4.addText("engineering@company.com", {
  x: 0.5, y: 3.5, w: 9, h: 0.6, fontSize: 16, fontFace: "Calibri",
  color: TEAL, align: "center"
});

const buffer = await pres.write({ outputType: "nodebuffer" });
saveFile("system-architecture-v3.pptx", buffer);
```

---

## 4. Educational Presentation (Warm Terracotta -- Friendly Theme)

```javascript
const pptxgen = require("pptxgenjs");
let pres = new pptxgen();
pres.layout = "LAYOUT_16x9";
pres.author = "IliaGPT";
pres.title = "Learning Module";

const TERRA = "B85042";
const SAND = "E7E8D1";
const SAGE = "A7BEAE";
const BODY = "3D3D3D";

// -- Slide 1: Title
let s1 = pres.addSlide();
s1.background = { color: TERRA };
s1.addText("Introduction to Machine Learning", {
  x: 0.5, y: 1.2, w: 9, h: 1.5, fontSize: 40, fontFace: "Palatino",
  color: "FFFFFF", bold: true, align: "center"
});
s1.addText("Module 3  |  Supervised Learning Fundamentals", {
  x: 0.5, y: 3.2, w: 9, h: 0.7, fontSize: 16, fontFace: "Garamond",
  color: SAND, align: "center"
});

// -- Slide 2: Learning Objectives
let s2 = pres.addSlide();
s2.background = { color: SAND };
s2.addShape(pres.shapes.RECTANGLE, {
  x: 0, y: 0, w: 0.15, h: 5.625, fill: { color: TERRA }
});
s2.addText("Learning Objectives", {
  x: 0.5, y: 0.3, w: 9, h: 0.8, fontSize: 28, fontFace: "Palatino",
  color: TERRA, bold: true
});
const objectives = [
  "Define supervised learning and identify real-world applications",
  "Distinguish between classification and regression problems",
  "Implement a basic linear regression model from scratch",
  "Evaluate model performance using standard metrics"
];
s2.addText(
  objectives.map((o, i) => ({
    text: o,
    options: { bullet: true, breakLine: i < objectives.length - 1 }
  })),
  { x: 0.7, y: 1.4, w: 8.5, h: 3.5, fontSize: 16, fontFace: "Garamond",
    color: BODY, lineSpacingMultiple: 1.8 }
);

// -- Slide 3: Key Concepts (two-column)
let s3 = pres.addSlide();
s3.background = { color: "FFFFFF" };
s3.addText("Key Concepts", {
  x: 0.5, y: 0.3, w: 9, h: 0.8, fontSize: 28, fontFace: "Palatino",
  color: TERRA, bold: true
});
// Left card
s3.addShape(pres.shapes.RECTANGLE, {
  x: 0.5, y: 1.3, w: 4.2, h: 3.5, fill: { color: SAND }
});
s3.addText("Classification", {
  x: 0.8, y: 1.5, w: 3.6, h: 0.6, fontSize: 20, fontFace: "Palatino",
  color: TERRA, bold: true
});
s3.addText("Predicts discrete categories: spam vs. not spam, tumor type, sentiment. Output is a label from a finite set.", {
  x: 0.8, y: 2.2, w: 3.6, h: 2.2, fontSize: 14, fontFace: "Garamond", color: BODY
});
// Right card
s3.addShape(pres.shapes.RECTANGLE, {
  x: 5.3, y: 1.3, w: 4.2, h: 3.5, fill: { color: SAGE }
});
s3.addText("Regression", {
  x: 5.6, y: 1.5, w: 3.6, h: 0.6, fontSize: 20, fontFace: "Palatino",
  color: TERRA, bold: true
});
s3.addText("Predicts continuous values: house prices, temperature, stock returns. Output is a number on a continuous scale.", {
  x: 5.6, y: 2.2, w: 3.6, h: 2.2, fontSize: 14, fontFace: "Garamond", color: BODY
});

// -- Slide 4: Summary
let s4 = pres.addSlide();
s4.background = { color: TERRA };
s4.addText("Key Takeaway", {
  x: 0.5, y: 1.5, w: 9, h: 1.0, fontSize: 36, fontFace: "Palatino",
  color: "FFFFFF", bold: true, align: "center"
});
s4.addText("Supervised learning maps inputs to known outputs. The choice between classification and regression depends on whether your target variable is categorical or continuous.", {
  x: 1.5, y: 2.8, w: 7, h: 1.8, fontSize: 16, fontFace: "Garamond",
  color: SAND, align: "center"
});

const buffer = await pres.write({ outputType: "nodebuffer" });
saveFile("ml-module-3-supervised-learning.pptx", buffer);
```

---

## 5. Minimalist Presentation (Charcoal Minimal -- Black/White Theme)

```javascript
const pptxgen = require("pptxgenjs");
let pres = new pptxgen();
pres.layout = "LAYOUT_16x9";
pres.author = "IliaGPT";
pres.title = "Minimalist Deck";

const CHARCOAL = "36454F";
const OFFWHITE = "F2F2F2";
const BLACK = "212121";

// -- Slide 1: Title
let s1 = pres.addSlide();
s1.background = { color: BLACK };
s1.addText("LESS IS MORE", {
  x: 0.5, y: 1.8, w: 9, h: 1.2, fontSize: 48, fontFace: "Arial Black",
  color: "FFFFFF", bold: true, align: "center", charSpacing: 4
});
s1.addText("A design philosophy for modern teams", {
  x: 0.5, y: 3.3, w: 9, h: 0.6, fontSize: 16, fontFace: "Arial",
  color: "888888", align: "center"
});

// -- Slide 2: The Problem (big stat)
let s2 = pres.addSlide();
s2.background = { color: "FFFFFF" };
s2.addText("73%", {
  x: 0.5, y: 0.8, w: 9, h: 2.0, fontSize: 96, fontFace: "Arial Black",
  color: BLACK, bold: true, align: "center"
});
s2.addText("of presentations contain more text than the audience can absorb in the allotted time.", {
  x: 1.5, y: 3.0, w: 7, h: 1.5, fontSize: 18, fontFace: "Arial",
  color: CHARCOAL, align: "center"
});
s2.addText("Source: Presentation Research Institute, 2025", {
  x: 0.5, y: 4.8, w: 9, h: 0.4, fontSize: 10, fontFace: "Arial",
  color: "AAAAAA", align: "center"
});

// -- Slide 3: Three Principles
let s3 = pres.addSlide();
s3.background = { color: OFFWHITE };
s3.addText("Three Principles", {
  x: 0.5, y: 0.3, w: 9, h: 0.8, fontSize: 28, fontFace: "Arial Black",
  color: BLACK, bold: true
});
const principles = [
  { num: "01", title: "Clarity", desc: "One idea per slide. Remove everything that does not support it." },
  { num: "02", title: "Contrast", desc: "Use size, weight, and whitespace to create visual hierarchy." },
  { num: "03", title: "Restraint", desc: "Two fonts, three colors, zero decoration for its own sake." }
];
principles.forEach((p, i) => {
  const y = 1.3 + i * 1.35;
  s3.addText(p.num, {
    x: 0.5, y, w: 0.8, h: 1.0, fontSize: 28, fontFace: "Arial Black",
    color: BLACK, bold: true, valign: "top", margin: 0
  });
  s3.addText(p.title, {
    x: 1.5, y, w: 2.5, h: 0.5, fontSize: 18, fontFace: "Arial Black",
    color: BLACK, bold: true, margin: 0
  });
  s3.addText(p.desc, {
    x: 1.5, y: y + 0.5, w: 7.5, h: 0.6, fontSize: 14, fontFace: "Arial",
    color: CHARCOAL, margin: 0
  });
});

// -- Slide 4: Closing
let s4 = pres.addSlide();
s4.background = { color: BLACK };
s4.addText("Start simple.\nStay simple.", {
  x: 0.5, y: 1.5, w: 9, h: 2.0, fontSize: 40, fontFace: "Arial Black",
  color: "FFFFFF", bold: true, align: "center"
});
s4.addText("hello@company.com", {
  x: 0.5, y: 4.2, w: 9, h: 0.5, fontSize: 14, fontFace: "Arial",
  color: "666666", align: "center"
});

const buffer = await pres.write({ outputType: "nodebuffer" });
saveFile("minimalist-deck.pptx", buffer);
```
