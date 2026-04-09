/**
 * Math Visualization Engine
 *
 * Parses natural language math requests and generates:
 * - Function expressions (2D, 3D, 4D, ND)
 * - Computation data (mesh grids, critical points)
 * - Interactive HTML artifact templates
 * - Math exercises with step-by-step solutions
 */

// ============================================================
// TYPES
// ============================================================

export type MathDimension = "2d" | "3d" | "4d" | "5d" | "6d" | "7d" | "8d";

export interface MathParseResult {
  dimension: MathDimension;
  type: "explicit" | "parametric" | "polar" | "implicit" | "nd-surface";
  expression: string;
  variables: string[];
  domain: Record<string, [number, number]>;
  title: string;
  language: "en" | "es";
  rawInput: string;
}

export interface MathMeshData {
  xValues: number[];
  yValues: number[];
  zValues: number[][];
  metadata: {
    xMin: number;
    xMax: number;
    yMin: number;
    yMax: number;
    zMin: number;
    zMax: number;
  };
}

export interface MathExercise {
  problem: string;
  steps: Array<{ description: string; result?: string }>;
  answer: string;
  graphType: "2d" | "3d" | "4d" | "none";
  expression?: string;
  xMin?: number;
  xMax?: number;
  title?: string;
}

// ============================================================
// MATH KEYWORD DETECTION
// ============================================================

const MATH_KEYWORDS_EN = [
  "graph", "plot", "draw", "sketch", "visualize", "show me",
  "parabola", "function", "equation", "curve", "surface",
  "3d", "4d", "5d", "6d", "7d", "8d", "three-dimensional",
  "four-dimensional", "hypersurface", "hyperplane",
  "paraboloid", "ellipsoid", "hyperboloid", "sphere",
  "solve", "find", "calculate", "compute", "vertex",
  "intersection", "roots", "zeros", "derivative", "integral",
  "sine", "cosine", "tangent", "exponential", "logarithm",
  "line chart", "bar chart", "scatter plot", "histogram", "chart",
  "linear regression", "quadratic", "polynomial", "trigonometric",
];

const MATH_KEYWORDS_ES = [
  "grafica", "grafíca", "graficar", "dibuja", "dibujar", "traza", "trazar",
  "visualiza", "muestra", "mostrar", "representa",
  "parábola", "parabola", "función", "funcion", "ecuación", "ecuacion",
  "curva", "superficie", "hiperplano", "hipersuperficie",
  "paraboloide", "elipsoide", "hiperboloide", "esfera",
  "resuelve", "resolver", "calcula", "calcular", "encuentra",
  "vértice", "vertice", "intersección", "interseccion",
  "raíces", "raices", "ceros", "derivada", "integral",
  "seno", "coseno", "tangente", "exponencial", "logaritmo",
  // tipos de gráficas adicionales
  "gráfica", "grafica", "gráfico", "grafico", "diagrama",
  "gráfica de líneas", "gráfica de barras", "gráfica de dispersión",
  "gráfica lineal", "gráfica cuadrática", "gráfica de puntos",
  "histograma", "diagrama de dispersión", "regresión", "tendencia",
  "línea de tendencia", "curva de nivel", "mapa de calor",
];

export function isMathRequest(message: string): boolean {
  const lower = message.toLowerCase();

  // Check for function notation patterns
  const mathPatterns = [
    /y\s*=\s*[^,\n]{2,}/i,
    /z\s*=\s*[^,\n]{2,}/i,
    /f\s*\([xy]\)\s*=/i,
    /[xyz]\^[23]/,
    /[xyz]\*\*[23]/,
    /\d+x\^?\d*/,
    /sin\(|cos\(|tan\(|sqrt\(/i,
  ];
  for (const pattern of mathPatterns) {
    if (pattern.test(message)) return true;
  }

  // Check for keyword matches
  for (const kw of [...MATH_KEYWORDS_EN, ...MATH_KEYWORDS_ES]) {
    if (lower.includes(kw)) return true;
  }

  return false;
}

export function detectLanguage(message: string): "en" | "es" {
  const lower = message.toLowerCase();
  const esCount = MATH_KEYWORDS_ES.filter((kw) => lower.includes(kw)).length;
  const enCount = MATH_KEYWORDS_EN.filter((kw) => lower.includes(kw)).length;
  return esCount > enCount ? "es" : "en";
}

// ============================================================
// EXPRESSION PARSER
// ============================================================

function normalizeExpression(expr: string): string {
  return expr
    .trim()
    .replace(/\s+/g, "")
    .replace(/×/g, "*")
    .replace(/÷/g, "/")
    .replace(/\^/g, "^") // keep for display; evaluate will convert to **
    .replace(/²/g, "^2")
    .replace(/³/g, "^3")
    .replace(/π/g, "pi")
    .replace(/e(?![a-z])/g, "e");
}

function extractExpression(input: string, after: string): string | null {
  const idx = input.toLowerCase().indexOf(after.toLowerCase());
  if (idx === -1) return null;
  const raw = input.slice(idx + after.length).trim();
  // Remove trailing punctuation, trailing phrases
  return raw.replace(/[,.].*$/, "").replace(/\s+en\s.*/i, "").replace(/\s+in\s.*/i, "").trim();
}

function detectDimension(input: string): MathDimension {
  const lower = input.toLowerCase();
  if (/8d|eight.?dim|8.?dimension/i.test(lower)) return "8d";
  if (/7d|seven.?dim|7.?dimension/i.test(lower)) return "7d";
  if (/6d|six.?dim|6.?dimension/i.test(lower)) return "6d";
  if (/5d|five.?dim|5.?dimension/i.test(lower)) return "5d";
  if (/4d|four.?dim|4.?dimension|cuatro.?d/i.test(lower)) return "4d";
  if (/3d|three.?dim|3.?dimension|tres.?d|superficie|surface|paraboloid/i.test(lower)) return "3d";
  return "2d";
}

function detectDomain(input: string, variables: string[]): Record<string, [number, number]> {
  const domain: Record<string, [number, number]> = {};

  // Look for explicit domain: "x from -5 to 5", "x de -5 a 5"
  const domainPattern = /(\w)\s*(?:from|de|entre)\s*(-?[\d.]+)\s*(?:to|a|hasta)\s*(-?[\d.]+)/gi;
  let m;
  while ((m = domainPattern.exec(input)) !== null) {
    const [, v, lo, hi] = m;
    domain[v] = [parseFloat(lo), parseFloat(hi)];
  }

  // Defaults for each variable
  for (const v of variables) {
    if (!domain[v]) {
      domain[v] = [-5, 5];
    }
  }

  return domain;
}

export function parseMathRequest(rawInput: string): MathParseResult | null {
  const lang = detectLanguage(rawInput);
  const dimension = detectDimension(rawInput);

  // Try to extract expression from common patterns
  let expression: string | null = null;
  let variables: string[] = [];
  let title = "";

  // Pattern: "y = <expr>", "z = <expr>", "f(x) = <expr>"
  const eqMatch = rawInput.match(/[yzwf]\s*(?:\([xyz,\s]*\))?\s*=\s*([^,\n]+)/i);
  if (eqMatch) {
    expression = normalizeExpression(eqMatch[1]);
  }

  if (!expression) {
    // Pattern: "graph <expr>", "grafica <expr>", "plot <expr>"
    const prefixes = [
      "graph", "plot", "draw", "sketch", "grafica", "grafíca", "dibuja",
      "traza", "visualiza", "muestra", "representa",
    ];
    for (const prefix of prefixes) {
      const extracted = extractExpression(rawInput, prefix);
      if (extracted && extracted.length > 1) {
        // Check if it starts with something mathsy
        if (/[xyz0-9\-\+]/.test(extracted[0])) {
          expression = normalizeExpression(extracted);
          break;
        }
        // Try "graph the parabola y = ..." style
        const subMatch = extracted.match(/y\s*=\s*([^,\n]+)/i) ??
                         extracted.match(/z\s*=\s*([^,\n]+)/i);
        if (subMatch) {
          expression = normalizeExpression(subMatch[1]);
          break;
        }
      }
    }
  }

  // Detect variables used
  if (expression) {
    if (/\bz\b/.test(expression)) {
      variables = ["x", "y", "z"];
    } else if (/\by\b/.test(expression) && dimension === "3d") {
      variables = ["x", "y"];
    } else if (/\by\b/.test(expression)) {
      variables = ["x"];
    } else {
      variables = ["x"];
    }

    // Determine title
    switch (dimension) {
      case "2d": title = `y = ${expression}`; break;
      case "3d": title = `z = ${expression}`; break;
      case "4d": title = `w = ${expression}`; break;
      default: title = expression;
    }
  }

  // Fallback: If no expression found but it's clearly a math request, use a default
  if (!expression) {
    if (/parab/i.test(rawInput)) {
      expression = "x^2";
      variables = ["x"];
      title = "y = x²";
    } else if (/paraboloid/i.test(rawInput)) {
      expression = "x^2+y^2";
      variables = ["x", "y"];
      title = "z = x² + y²";
      if (dimension === "2d") return null; // override
    } else {
      return null;
    }
  }

  const domain = detectDomain(rawInput, variables);

  return {
    dimension,
    type: "explicit",
    expression,
    variables,
    domain,
    title,
    language: lang,
    rawInput,
  };
}

// ============================================================
// MESH COMPUTATION
// ============================================================

function safeEval(expr: string, vars: Record<string, number>): number {
  try {
    let cleaned = expr
      .replace(/\^/g, "**")
      .replace(/π/g, String(Math.PI))
      .replace(/pi/gi, String(Math.PI));

    for (const [name, val] of Object.entries(vars)) {
      cleaned = cleaned.replace(new RegExp(`\\b${name}\\b`, "g"), `(${val})`);
    }

    cleaned = cleaned
      .replace(/\bsin\(/g, "Math.sin(")
      .replace(/\bcos\(/g, "Math.cos(")
      .replace(/\btan\(/g, "Math.tan(")
      .replace(/\bsqrt\(/g, "Math.sqrt(")
      .replace(/\babs\(/g, "Math.abs(")
      .replace(/\blog\(/g, "Math.log10(")
      .replace(/\bln\(/g, "Math.log(")
      .replace(/\bexp\(/g, "Math.exp(")
      .replace(/\bpow\(/g, "Math.pow(");

    // eslint-disable-next-line no-new-func
    const fn = new Function("Math", `return ${cleaned}`);
    const result = fn(Math);
    return typeof result === "number" && isFinite(result) ? result : NaN;
  } catch {
    return NaN;
  }
}

export function computeMesh2D(
  expression: string,
  xMin: number,
  xMax: number,
  steps = 200
): Array<{ x: number; y: number }> {
  const points: Array<{ x: number; y: number }> = [];
  const step = (xMax - xMin) / steps;
  for (let i = 0; i <= steps; i++) {
    const x = xMin + i * step;
    const y = safeEval(expression, { x });
    if (!isNaN(y)) points.push({ x, y });
  }
  return points;
}

export function computeMesh3D(
  expression: string,
  xMin: number,
  xMax: number,
  yMin: number,
  yMax: number,
  resolution = 40
): MathMeshData {
  const xValues: number[] = [];
  const yValues: number[] = [];
  const zValues: number[][] = [];
  let zMin = Infinity, zMax = -Infinity;

  for (let i = 0; i <= resolution; i++) {
    xValues.push(xMin + (i / resolution) * (xMax - xMin));
  }
  for (let j = 0; j <= resolution; j++) {
    yValues.push(yMin + (j / resolution) * (yMax - yMin));
  }

  for (let i = 0; i <= resolution; i++) {
    zValues[i] = [];
    for (let j = 0; j <= resolution; j++) {
      const z = safeEval(expression, { x: xValues[i], y: yValues[j] });
      const zSafe = isNaN(z) ? 0 : z;
      zValues[i][j] = zSafe;
      if (!isNaN(z)) {
        zMin = Math.min(zMin, z);
        zMax = Math.max(zMax, z);
      }
    }
  }

  return {
    xValues,
    yValues,
    zValues,
    metadata: {
      xMin, xMax, yMin, yMax,
      zMin: isFinite(zMin) ? zMin : -1,
      zMax: isFinite(zMax) ? zMax : 1,
    },
  };
}

export function findCriticalPoints2D(
  expression: string,
  xMin: number,
  xMax: number
): Array<{ x: number; y: number; type: "min" | "max" | "inflection" }> {
  const h = 0.001;
  const steps = 500;
  const dx = (xMax - xMin) / steps;
  const criticals: Array<{ x: number; y: number; type: "min" | "max" | "inflection" }> = [];

  let prevSign = 0;
  for (let i = 1; i < steps; i++) {
    const x = xMin + i * dx;
    const dy = (safeEval(expression, { x: x + h }) - safeEval(expression, { x: x - h })) / (2 * h);
    const sign = Math.sign(dy);

    if (prevSign !== 0 && sign !== prevSign && Math.abs(dy) < 0.5) {
      const y = safeEval(expression, { x });
      const d2y = (safeEval(expression, { x: x + h }) - 2 * y + safeEval(expression, { x: x - h })) / (h * h);
      criticals.push({
        x: Math.round(x * 100) / 100,
        y: Math.round(y * 100) / 100,
        type: d2y > 0 ? "min" : d2y < 0 ? "max" : "inflection",
      });
    }
    prevSign = sign;
  }

  return criticals.slice(0, 10); // cap at 10 results
}

// ============================================================
// EXERCISE GENERATOR
// ============================================================

export function generateParabolaExercise(a: number, b: number, c: number): MathExercise {
  const sign = (n: number) => n >= 0 ? `+${n}` : `${n}`;
  const expr = `${a}*x^2${sign(b)}*x${sign(c)}`;
  const vertex_x = -b / (2 * a);
  const vertex_y = a * vertex_x ** 2 + b * vertex_x + c;
  const disc = b ** 2 - 4 * a * c;

  const steps: Array<{ description: string; result?: string }> = [
    {
      description: `Identify the standard form: y = ax² + bx + c`,
      result: `a=${a}, b=${b}, c=${c}`,
    },
    {
      description: `Find the vertex using x = -b/(2a)`,
      result: `x = -${b}/(2×${a}) = ${vertex_x.toFixed(2)}`,
    },
    {
      description: `Substitute back to find y at the vertex`,
      result: `y = ${vertex_y.toFixed(2)}`,
    },
    {
      description: `Determine opening direction: a ${a > 0 ? "> 0" : "< 0"} so the parabola opens ${a > 0 ? "upward ↑" : "downward ↓"}`,
    },
  ];

  if (disc >= 0) {
    const x1 = (-b + Math.sqrt(disc)) / (2 * a);
    const x2 = (-b - Math.sqrt(disc)) / (2 * a);
    steps.push({
      description: disc === 0
        ? `The discriminant is 0: one root (tangent to x-axis)`
        : `Use the quadratic formula: x = (-b ± √(b²-4ac)) / (2a)`,
      result: disc === 0
        ? `x = ${x1.toFixed(2)}`
        : `x₁ = ${x1.toFixed(2)}, x₂ = ${x2.toFixed(2)}`,
    });
  } else {
    steps.push({
      description: `Discriminant Δ = b²-4ac = ${disc.toFixed(2)} < 0: no real roots`,
    });
  }

  const xMin = vertex_x - 5;
  const xMax = vertex_x + 5;

  return {
    problem: `Graph and analyze the parabola: y = ${a}x² ${b >= 0 ? "+" : ""}${b}x ${c >= 0 ? "+" : ""}${c}`,
    steps,
    answer: `Vertex: (${vertex_x.toFixed(2)}, ${vertex_y.toFixed(2)}), opens ${a > 0 ? "upward" : "downward"}`,
    graphType: "2d",
    expression: expr,
    xMin,
    xMax,
    title: `y = ${a}x² ${b >= 0 ? "+" : ""}${b}x ${c >= 0 ? "+" : ""}${c}`,
  };
}

// ============================================================
// HTML ARTIFACT TEMPLATE GENERATORS
// ============================================================

export function generateMath2DArtifact(
  expression: string,
  title: string,
  xMin = -10,
  xMax = 10,
  additionalExpressions: Array<{ expr: string; color: string; label: string }> = []
): string {
  const extraExprs = JSON.stringify(additionalExpressions);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #0f172a; color: #e2e8f0; font-family: monospace; padding: 12px; display: flex; flex-direction: column; gap: 8px; min-height: 100vh; }
  canvas { width: 100%; border-radius: 8px; cursor: crosshair; }
  .controls { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; font-size: 12px; color: #94a3b8; }
  button { background: #1e293b; border: 1px solid #334155; color: #e2e8f0; border-radius: 4px; padding: 4px 8px; cursor: pointer; font-size: 11px; font-family: monospace; }
  button:hover { background: #334155; }
  .info { font-size: 11px; color: #64748b; }
  h1 { font-size: 14px; font-weight: bold; color: #e2e8f0; }
</style>
</head>
<body>
<h1>📈 ${title}</h1>
<canvas id="c"></canvas>
<div class="controls">
  <span class="info">Scroll to zoom · Drag to pan · Hover for values</span>
  <button onclick="resetView()">Reset View</button>
</div>
<div id="coord" class="info"></div>
<script>
const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
let zoom = 1, panX = 0, panY = 0;
let isDragging = false, lastMx = 0, lastMy = 0;
let hoverX = null, hoverY = null;

const EXPR = ${JSON.stringify(expression)};
const TITLE = ${JSON.stringify(title)};
const X_MIN_BASE = ${xMin};
const X_MAX_BASE = ${xMax};
const EXTRA = ${extraExprs};
const COLORS = ['#818cf8', '#34d399', '#f59e0b', '#f87171', '#60a5fa'];

function evalExpr(expr, x) {
  try {
    const cleaned = expr.replace(/\\^/g,'**')
      .replace(/\\bx\\b/g, '(' + x + ')')
      .replace(/\\bpi\\b/gi, Math.PI)
      .replace(/\\bsin\\(/g,'Math.sin(')
      .replace(/\\bcos\\(/g,'Math.cos(')
      .replace(/\\btan\\(/g,'Math.tan(')
      .replace(/\\bsqrt\\(/g,'Math.sqrt(')
      .replace(/\\babs\\(/g,'Math.abs(')
      .replace(/\\bexp\\(/g,'Math.exp(')
      .replace(/\\bln\\(/g,'Math.log(')
      .replace(/\\blog\\(/g,'Math.log10(')
      .replace(/\\bpow\\(/g,'Math.pow(');
    const f = new Function('Math', 'return ' + cleaned);
    const r = f(Math);
    return (typeof r === 'number' && isFinite(r)) ? r : NaN;
  } catch(e) { return NaN; }
}

function getXRange() {
  const xMin = X_MIN_BASE / zoom + panX;
  const xMax = X_MAX_BASE / zoom + panX;
  return [xMin, xMax];
}

function resize() {
  canvas.width = canvas.offsetWidth * devicePixelRatio;
  canvas.height = Math.min(450, Math.round(canvas.offsetWidth * 0.65)) * devicePixelRatio;
  canvas.style.height = Math.min(450, Math.round(canvas.offsetWidth * 0.65)) + 'px';
  draw();
}

function getPoints(expr, xMin, xMax) {
  const W = canvas.width, steps = Math.max(200, W / 2);
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const x = xMin + (i / steps) * (xMax - xMin);
    const y = evalExpr(expr, x);
    if (!isNaN(y)) pts.push({x, y});
  }
  return pts;
}

function draw() {
  const W = canvas.width, H = canvas.height;
  const pad = Math.round(42 * devicePixelRatio);
  const [xMin, xMax] = getXRange();

  // Get y range from data
  const allPts = [getPoints(EXPR, xMin, xMax), ...EXTRA.map(e => getPoints(e.expr, xMin, xMax))];
  const allY = allPts.flat().map(p => p.y).filter(y => isFinite(y));
  let yMin = allY.length ? Math.min(...allY) : -10;
  let yMax = allY.length ? Math.max(...allY) : 10;
  if (yMax - yMin < 0.01) { yMin -= 5; yMax += 5; }
  const yPad = (yMax - yMin) * 0.05;
  yMin -= yPad; yMax += yPad;

  function toPixel(x, y) {
    const px = pad + (x - xMin) / (xMax - xMin) * (W - 2 * pad);
    const py = H - pad - (y - yMin) / (yMax - yMin) * (H - 2 * pad);
    return [px, py];
  }

  // Background
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, W, H);

  // Grid
  ctx.strokeStyle = '#1e293b';
  ctx.lineWidth = 1;
  const xTicks = 10, yTicks = 8;
  for (let i = 0; i <= xTicks; i++) {
    const x = xMin + (i/xTicks)*(xMax-xMin);
    const [px] = toPixel(x, 0);
    ctx.beginPath(); ctx.moveTo(px, pad); ctx.lineTo(px, H-pad); ctx.stroke();
  }
  for (let i = 0; i <= yTicks; i++) {
    const y = yMin + (i/yTicks)*(yMax-yMin);
    const [,py] = toPixel(0, y);
    ctx.beginPath(); ctx.moveTo(pad, py); ctx.lineTo(W-pad, py); ctx.stroke();
  }

  // Axes
  ctx.strokeStyle = '#475569'; ctx.lineWidth = 1.5;
  if (yMin <= 0 && yMax >= 0) { const [,py0] = toPixel(0,0); ctx.beginPath(); ctx.moveTo(pad,py0); ctx.lineTo(W-pad,py0); ctx.stroke(); }
  if (xMin <= 0 && xMax >= 0) { const [px0] = toPixel(0,0); ctx.beginPath(); ctx.moveTo(px0,pad); ctx.lineTo(px0,H-pad); ctx.stroke(); }

  // Axis labels
  ctx.fillStyle = '#64748b'; ctx.font = (10*devicePixelRatio)+'px monospace'; ctx.textAlign = 'center';
  for (let i = 0; i <= xTicks; i++) {
    const x = xMin + (i/xTicks)*(xMax-xMin);
    const [px] = toPixel(x, yMin);
    ctx.fillText(x.toFixed(1), px, H-pad+14*devicePixelRatio);
  }
  ctx.textAlign = 'right';
  for (let i = 0; i <= yTicks; i++) {
    const y = yMin + (i/yTicks)*(yMax-yMin);
    const [,py] = toPixel(xMin, y);
    ctx.fillText(y.toFixed(1), pad-4, py+4);
  }

  // Curves
  const curves = [{expr: EXPR, color: COLORS[0]}, ...EXTRA.map((e,i) => ({expr:e.expr, color: e.color || COLORS[i+1]}))];
  curves.forEach(({expr, color}, idx) => {
    const pts = allPts[idx];
    ctx.strokeStyle = color; ctx.lineWidth = 2.5 * devicePixelRatio; ctx.lineJoin = 'round';
    ctx.beginPath();
    let started = false;
    for (const pt of pts) {
      const [px,py] = toPixel(pt.x, pt.y);
      if (!started) { ctx.moveTo(px,py); started=true; } else ctx.lineTo(px,py);
    }
    ctx.stroke();
  });

  // Hover point
  if (hoverX !== null) {
    const hY = evalExpr(EXPR, hoverX);
    if (!isNaN(hY)) {
      const [hpx, hpy] = toPixel(hoverX, hY);
      ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = devicePixelRatio;
      ctx.setLineDash([4*devicePixelRatio, 4*devicePixelRatio]);
      ctx.beginPath(); ctx.moveTo(hpx,pad); ctx.lineTo(hpx,H-pad); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(pad,hpy); ctx.lineTo(W-pad,hpy); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = COLORS[0];
      ctx.beginPath(); ctx.arc(hpx,hpy,5*devicePixelRatio,0,2*Math.PI); ctx.fill();
      document.getElementById('coord').textContent = 'x = ' + hoverX.toFixed(3) + ', y = ' + hY.toFixed(3);
    }
  }

  // Title
  ctx.fillStyle = '#e2e8f0'; ctx.font = 'bold '+(13*devicePixelRatio)+'px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText(TITLE, W/2, 18*devicePixelRatio);
}

canvas.addEventListener('wheel', e => {
  e.preventDefault();
  zoom *= e.deltaY > 0 ? 0.85 : 1.18;
  zoom = Math.min(Math.max(zoom, 0.05), 100);
  draw();
}, {passive: false});

canvas.addEventListener('mousedown', e => { isDragging=true; lastMx=e.clientX; lastMy=e.clientY; });
canvas.addEventListener('mousemove', e => {
  const rect = canvas.getBoundingClientRect();
  const mx = (e.clientX - rect.left) / rect.width * canvas.width;
  const [xMin, xMax] = getXRange();
  const pad = 42 * devicePixelRatio;
  hoverX = xMin + (mx - pad) / (canvas.width - 2*pad) * (xMax - xMin);
  if (isDragging) {
    const dxPx = e.clientX - lastMx, dyPx = e.clientY - lastMy;
    const [xMin2, xMax2] = getXRange();
    panX -= dxPx / canvas.offsetWidth * (xMax2 - xMin2);
    lastMx=e.clientX; lastMy=e.clientY;
  }
  draw();
});
canvas.addEventListener('mouseup', () => isDragging=false);
canvas.addEventListener('mouseleave', () => { isDragging=false; hoverX=null; document.getElementById('coord').textContent=''; draw(); });

function resetView() { zoom=1; panX=0; panY=0; draw(); }

new ResizeObserver(resize).observe(canvas);
resize();
</script>
</body>
</html>`;
}

export function generateMath3DArtifact(
  expression: string,
  title: string,
  xMin = -5,
  xMax = 5,
  yMin = -5,
  yMax = 5,
  resolution = 40
): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${title}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #0f172a; color: #e2e8f0; font-family: monospace; padding: 12px; display: flex; flex-direction: column; gap: 8px; min-height: 100vh; }
  canvas { width: 100%; border-radius: 8px; cursor: grab; }
  canvas.dragging { cursor: grabbing; }
  .controls { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; font-size: 12px; color: #94a3b8; }
  button { background: #1e293b; border: 1px solid #334155; color: #e2e8f0; border-radius: 4px; padding: 4px 8px; cursor: pointer; font-size: 11px; font-family: monospace; }
  button.active { background: #4f46e5; border-color: #4f46e5; }
  button:hover { background: #334155; }
  select { background: #1e293b; border: 1px solid #334155; color: #e2e8f0; border-radius: 4px; padding: 4px 6px; font-size: 11px; font-family: monospace; }
  h1 { font-size: 14px; font-weight: bold; color: #e2e8f0; }
</style>
</head>
<body>
<h1>🌐 ${title}</h1>
<canvas id="c"></canvas>
<div class="controls">
  <span>Drag to rotate · Scroll to zoom</span>
  <div style="display:flex;gap:6px;align-items:center">
    <button id="wfBtn" onclick="toggleWireframe()">Wireframe</button>
    <select id="schemeSelect" onchange="scheme=this.value;draw()">
      <option value="viridis">Viridis</option>
      <option value="plasma">Plasma</option>
      <option value="cool">Cool</option>
      <option value="warm">Warm</option>
    </select>
    <button onclick="resetView()">Reset</button>
  </div>
</div>
<script>
const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
const EXPR = ${JSON.stringify(expression)};
const TITLE = ${JSON.stringify(title)};
const X_MIN=${xMin}, X_MAX=${xMax}, Y_MIN=${yMin}, Y_MAX=${yMax};
const N = ${resolution};
let rotX=0.5, rotY=0.3, zoom=1, wireframe=false, scheme='viridis';
let isDragging=false, lastMx=0, lastMy=0;

function evalXY(expr, x, y) {
  try {
    const c = expr.replace(/\\^/g,'**')
      .replace(/\\bx\\b/g,'('+x+')')
      .replace(/\\by\\b/g,'('+y+')')
      .replace(/\\bpi\\b/gi,Math.PI)
      .replace(/\\bsin\\(/g,'Math.sin(')
      .replace(/\\bcos\\(/g,'Math.cos(')
      .replace(/\\btan\\(/g,'Math.tan(')
      .replace(/\\bsqrt\\(/g,'Math.sqrt(')
      .replace(/\\babs\\(/g,'Math.abs(')
      .replace(/\\bexp\\(/g,'Math.exp(')
      .replace(/\\bpow\\(/g,'Math.pow(');
    const f = new Function('Math','return '+c);
    const r = f(Math);
    return (typeof r==='number'&&isFinite(r))?r:NaN;
  } catch(e){return NaN;}
}

function colorFromT(t, sch) {
  switch(sch) {
    case 'plasma': return [Math.round(Math.min(255,Math.max(0,255*(0.05+2*t)))), Math.round(255*Math.min(1,4*t*(1-t)*0.3)), Math.round(255*Math.max(0,0.7-t))];
    case 'cool': return [Math.round(255*t), Math.round(255*(1-t)), 255];
    case 'warm': return [255, Math.round(255*(1-t)), Math.round(100*(1-t))];
    default: return [Math.round(Math.min(255,Math.max(0,255*(-0.5+2.5*t)))), Math.round(255*Math.min(1,0.8*Math.sin(Math.PI*t))), Math.round(255*Math.max(0,0.9-t))];
  }
}

function buildGrid() {
  const grid=[], xVals=[], yVals=[];
  let zMin=Infinity, zMax=-Infinity;
  for(let i=0;i<=N;i++) xVals.push(X_MIN+(i/N)*(X_MAX-X_MIN));
  for(let j=0;j<=N;j++) yVals.push(Y_MIN+(j/N)*(Y_MAX-Y_MIN));
  for(let i=0;i<=N;i++){
    grid[i]=[];
    for(let j=0;j<=N;j++){
      const z=evalXY(EXPR,xVals[i],yVals[j]);
      const zs=isNaN(z)?0:z;
      grid[i][j]=zs;
      if(!isNaN(z)){zMin=Math.min(zMin,z);zMax=Math.max(zMax,z);}
    }
  }
  if(!isFinite(zMin))zMin=-1;
  if(!isFinite(zMax))zMax=1;
  return {grid,xVals,yVals,zMin,zMax};
}

let cachedGrid = null;
function getGrid(){return cachedGrid||(cachedGrid=buildGrid());}

function project(ix,jy,grid,zMin,zRange,W,H){
  const xR=X_MAX-X_MIN, yR=Y_MAX-Y_MIN;
  const nx=(ix/N-0.5)*xR, ny=(jy/N-0.5)*yR;
  const nz=((grid[ix][jy]-zMin)/zRange-0.5)*xR;
  const cosX=Math.cos(rotX), sinX=Math.sin(rotX);
  const cosY=Math.cos(rotY), sinY=Math.sin(rotY);
  const rx=nx*cosY-nz*sinY, rz=nx*sinY+nz*cosY;
  const ry1=ny*cosX-rz*sinX, rz2=ny*sinX+rz*cosX;
  const scale=zoom*(Math.min(W,H))/(3.5*(X_MAX-X_MIN));
  const persp=4/(4+rz2);
  return [W/2+rx*scale*persp, H/2-ry1*scale*persp, grid[ix][jy]];
}

function draw(){
  const W=canvas.width, H=canvas.height;
  const {grid,zMin,zMax}=getGrid();
  const zRange=zMax-zMin||1;
  ctx.fillStyle='#0f172a'; ctx.fillRect(0,0,W,H);

  const faces=[];
  for(let i=0;i<N;i++) for(let j=0;j<N;j++){
    const [p00x,p00y,z00]=project(i,j,grid,zMin,zRange,W,H);
    const [p10x,p10y,z10]=project(i+1,j,grid,zMin,zRange,W,H);
    const [p11x,p11y,z11]=project(i+1,j+1,grid,zMin,zRange,W,H);
    const [p01x,p01y,z01]=project(i,j+1,grid,zMin,zRange,W,H);
    const avgZ=(z00+z10+z11+z01)/4;
    faces.push({pts:[[p00x,p00y],[p10x,p10y],[p11x,p11y],[p01x,p01y]],avgZ,t:(avgZ-zMin)/zRange});
  }
  faces.sort((a,b)=>a.avgZ-b.avgZ);
  for(const f of faces){
    const [r,g,b]=colorFromT(f.t,scheme);
    ctx.beginPath(); ctx.moveTo(f.pts[0][0],f.pts[0][1]);
    for(let k=1;k<f.pts.length;k++) ctx.lineTo(f.pts[k][0],f.pts[k][1]);
    ctx.closePath();
    if(!wireframe){ctx.fillStyle='rgba('+r+','+g+','+b+',0.85)';ctx.fill();}
    ctx.strokeStyle=wireframe?'rgba('+r+','+g+','+b+',0.9)':'rgba('+(r-40)+','+(g-40)+','+(b-40)+',0.3)';
    ctx.lineWidth=wireframe?1:0.5; ctx.stroke();
  }
  ctx.fillStyle='#e2e8f0'; ctx.font='bold 13px sans-serif'; ctx.textAlign='center';
  ctx.fillText(TITLE,W/2,18);
  ctx.fillStyle='#64748b'; ctx.font='11px monospace'; ctx.textAlign='left';
  ctx.fillText('z = '+EXPR, 10, H-10);
}

function toggleWireframe(){wireframe=!wireframe;document.getElementById('wfBtn').classList.toggle('active',wireframe);draw();}
function resetView(){rotX=0.5;rotY=0.3;zoom=1;draw();}

canvas.addEventListener('mousedown',e=>{isDragging=true;lastMx=e.clientX;lastMy=e.clientY;canvas.classList.add('dragging');});
canvas.addEventListener('mousemove',e=>{
  if(!isDragging)return;
  rotY+=(e.clientX-lastMx)*0.01;
  rotX+=(e.clientY-lastMy)*0.01;
  lastMx=e.clientX;lastMy=e.clientY;draw();
});
canvas.addEventListener('mouseup',()=>{isDragging=false;canvas.classList.remove('dragging');});
canvas.addEventListener('mouseleave',()=>{isDragging=false;canvas.classList.remove('dragging');});
canvas.addEventListener('wheel',e=>{e.preventDefault();zoom*=e.deltaY>0?0.9:1.1;zoom=Math.min(Math.max(zoom,0.2),5);draw();},{passive:false});

function resize(){
  canvas.width=canvas.offsetWidth*devicePixelRatio;
  const h=Math.min(460,Math.round(canvas.offsetWidth*0.7));
  canvas.height=h*devicePixelRatio;
  canvas.style.height=h+'px';
  cachedGrid=null; draw();
}
new ResizeObserver(resize).observe(canvas);
resize();
</script>
</body>
</html>`;
}

export function generateMath4DArtifact(expression: string, title: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${title}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #0f172a; color: #e2e8f0; font-family: monospace; padding: 12px; display: flex; flex-direction: column; gap: 8px; min-height: 100vh; }
  canvas { width: 100%; border-radius: 8px; cursor: grab; }
  .controls { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; font-size: 12px; color: #94a3b8; }
  button { background: #1e293b; border: 1px solid #334155; color: #e2e8f0; border-radius: 4px; padding: 4px 8px; cursor: pointer; font-size: 11px; font-family: monospace; }
  button.active { background: #4f46e5; border-color: #4f46e5; }
  input[type=range] { accent-color: #4f46e5; }
  h1 { font-size: 14px; font-weight: bold; }
</style>
</head>
<body>
<h1>🔮 ${title}</h1>
<canvas id="c"></canvas>
<div class="controls">
  <span>4D: color = w value · animated z-slices · drag to rotate</span>
  <div style="display:flex;gap:6px;align-items:center">
    <button id="playBtn" onclick="togglePlay()">⏸ Pause</button>
    <label style="display:flex;align-items:center;gap:4px">z: <input type="range" id="zSlider" min="-3" max="3" step="0.05" value="0" oninput="onZChange(this.value)"></label>
    <button onclick="rotX=0.5;rotY=0.3;draw()">Reset</button>
  </div>
</div>
<script>
const canvas=document.getElementById('c');
const ctx=canvas.getContext('2d');
const EXPR=${JSON.stringify(expression)};
const TITLE=${JSON.stringify(title)};
const N=25;
let rotX=0.5,rotY=0.3,isPlaying=true,zVal=0,animT=0;
let isDragging=false,lastMx=0,lastMy=0,animId=null;

function eval4D(expr,x,y,z){
  try{
    const c=expr.replace(/\\^/g,'**')
      .replace(/\\bx\\b/g,'('+x+')').replace(/\\by\\b/g,'('+y+')').replace(/\\bz\\b/g,'('+z+')')
      .replace(/\\bpi\\b/gi,Math.PI)
      .replace(/\\bsin\\(/g,'Math.sin(').replace(/\\bcos\\(/g,'Math.cos(')
      .replace(/\\bsqrt\\(/g,'Math.sqrt(').replace(/\\babs\\(/g,'Math.abs(')
      .replace(/\\bexp\\(/g,'Math.exp(');
    const f=new Function('Math','return '+c);
    const r=f(Math);
    return(typeof r==='number'&&isFinite(r))?r:NaN;
  }catch(e){return NaN;}
}

function colorFromW(t){const h=(1-Math.max(0,Math.min(1,t)))*240;return'hsl('+h+',80%,55%)';}

function drawSlice(z){
  const W=canvas.width,H=canvas.height,cx=W/2,cy=H/2;
  const cosX=Math.cos(rotX),sinX=Math.sin(rotX),cosY=Math.cos(rotY),sinY=Math.sin(rotY);
  const scale=Math.min(W,H)*0.35/3;
  const XR=6;
  const grid=[],wVals=[];
  let wMin=Infinity,wMax=-Infinity;
  for(let i=0;i<=N;i++){
    grid[i]=[];
    for(let j=0;j<=N;j++){
      const x=-3+i/N*6,y=-3+j/N*6;
      const w=eval4D(EXPR,x,y,z);
      const ws=isNaN(w)?0:w;
      grid[i][j]=ws;
      if(!isNaN(w)){wMin=Math.min(wMin,w);wMax=Math.max(wMax,w);}
    }
  }
  if(!isFinite(wMin))wMin=-1;if(!isFinite(wMax))wMax=1;
  const wRange=wMax-wMin||1;

  function proj(ix,jy){
    const nx=(ix/N-0.5)*XR,ny=(jy/N-0.5)*XR,nz=0;
    const rx=nx*cosY-nz*sinY,rz=nx*sinY+nz*cosY;
    const ry=ny*cosX-rz*sinX,rz2=ny*sinX+rz*cosX;
    const p=4/(4+rz2);
    return[cx+rx*scale*p,cy-ry*scale*p];
  }

  ctx.fillStyle='#0f172a';ctx.fillRect(0,0,W,H);
  for(let i=0;i<N;i++) for(let j=0;j<N;j++){
    const [x0,y0]=proj(i,j),[x1,y1]=proj(i+1,j),[x2,y2]=proj(i+1,j+1),[x3,y3]=proj(i,j+1);
    const t=(grid[i][j]-wMin)/wRange;
    ctx.fillStyle=colorFromW(t);
    ctx.beginPath();ctx.moveTo(x0,y0);ctx.lineTo(x1,y1);ctx.lineTo(x2,y2);ctx.lineTo(x3,y3);ctx.closePath();ctx.fill();
    ctx.strokeStyle='rgba(0,0,0,0.1)';ctx.lineWidth=0.5;ctx.stroke();
  }

  ctx.fillStyle='#e2e8f0';ctx.font='bold 13px sans-serif';ctx.textAlign='center';ctx.fillText(TITLE,W/2,18);
  ctx.fillStyle='#64748b';ctx.font='11px monospace';ctx.textAlign='left';
  ctx.fillText('w = '+EXPR,10,H-28);ctx.fillText('z = '+z.toFixed(2),10,H-12);

  const lw=80,lx=W-lw-10,ly=H-25;
  const g=ctx.createLinearGradient(lx,0,lx+lw,0);
  g.addColorStop(0,'hsl(240,80%,55%)');g.addColorStop(0.5,'hsl(120,80%,55%)');g.addColorStop(1,'hsl(0,80%,55%)');
  ctx.fillStyle=g;ctx.fillRect(lx,ly,lw,10);
  ctx.fillStyle='#94a3b8';ctx.font='9px monospace';
  ctx.textAlign='left';ctx.fillText(wMin.toFixed(1),lx,ly+22);
  ctx.textAlign='right';ctx.fillText(wMax.toFixed(1),lx+lw,ly+22);
  ctx.textAlign='center';ctx.fillText('w',lx+lw/2,ly-3);
}

function animate(){
  if(!isPlaying){drawSlice(zVal);return;}
  animT+=0.008;
  zVal=-3+((Math.sin(animT)+1)/2)*6;
  document.getElementById('zSlider').value=zVal;
  drawSlice(zVal);
  animId=requestAnimationFrame(animate);
}
function togglePlay(){
  isPlaying=!isPlaying;
  document.getElementById('playBtn').textContent=isPlaying?'⏸ Pause':'▶ Play';
  if(isPlaying)animate(); else cancelAnimationFrame(animId);
}
function onZChange(v){zVal=parseFloat(v);if(!isPlaying)drawSlice(zVal);}

canvas.addEventListener('mousedown',e=>{isDragging=true;lastMx=e.clientX;lastMy=e.clientY;});
canvas.addEventListener('mousemove',e=>{if(!isDragging)return;rotY+=(e.clientX-lastMx)*0.01;rotX+=(e.clientY-lastMy)*0.01;lastMx=e.clientX;lastMy=e.clientY;});
canvas.addEventListener('mouseup',()=>isDragging=false);canvas.addEventListener('mouseleave',()=>isDragging=false);

function resize(){
  canvas.width=canvas.offsetWidth*devicePixelRatio;
  const h=Math.min(450,Math.round(canvas.offsetWidth*0.7));
  canvas.height=h*devicePixelRatio;canvas.style.height=h+'px';
}
new ResizeObserver(resize).observe(canvas);
resize();
animate();
</script>
</body>
</html>`;
}

export function generateMathNDArtifact(title: string, dimensions: number): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${title}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #0f172a; color: #e2e8f0; font-family: monospace; padding: 12px; display: flex; flex-direction: column; gap: 8px; min-height: 100vh; }
  canvas { width: 100%; border-radius: 8px; }
  .controls { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; font-size: 12px; color: #94a3b8; }
  button { background: #1e293b; border: 1px solid #334155; color: #e2e8f0; border-radius: 4px; padding: 4px 8px; cursor: pointer; font-size: 11px; font-family: monospace; }
  button.active { background: #4f46e5; border-color: #4f46e5; }
  h1 { font-size: 14px; font-weight: bold; }
</style>
</head>
<body>
<h1>📊 ${title}</h1>
<canvas id="c"></canvas>
<div class="controls">
  <span>${dimensions}D visualization via parallel coordinates</span>
  <div style="display:flex;gap:6px">
    <button id="mParallel" class="active" onclick="setMode('parallel')">Parallel</button>
    <button id="mScatter" onclick="setMode('scatter')">Scatter</button>
    <button id="mRadar" onclick="setMode('radar')">Radar</button>
  </div>
</div>
<script>
const canvas=document.getElementById('c');
const ctx=canvas.getContext('2d');
const DIMS=${dimensions};
const TITLE=${JSON.stringify(title)};
let mode='parallel';

// Generate sample data for the ND visualization
const LABELS=Array.from({length:DIMS},(_,i)=>'x'+(i+1));
const N_PTS=50;
const rawPts=Array.from({length:N_PTS},(_,pi)=>({
  values:Array.from({length:DIMS},(_,di)=>Math.sin(pi*0.3+di*1.1)*3+Math.random()*2-1),
  label:'pt'+pi
}));

function normalize(pts){
  const dims=pts[0].values.length;
  const mins=Array(dims).fill(Infinity),maxs=Array(dims).fill(-Infinity);
  for(const pt of pts) for(let d=0;d<dims;d++){mins[d]=Math.min(mins[d],pt.values[d]);maxs[d]=Math.max(maxs[d],pt.values[d]);}
  return pts.map(pt=>({...pt,values:pt.values.map((v,d)=>{const r=maxs[d]-mins[d];return r<1e-10?0.5:(v-mins[d])/r;})}));
}

const normed=normalize(rawPts);

function hsl(i,total){return 'hsla('+(i/Math.max(total-1,1)*280)+',80%,60%,0.7)';}
function hslV(t){return 'hsl('+(1-t)*240+',80%,60%)';}

function drawParallel(){
  const W=canvas.width,H=canvas.height;
  const pad={top:40,bottom:30,left:40,right:40};
  const asp=(W-pad.left-pad.right)/(DIMS-1);
  ctx.fillStyle='#0f172a';ctx.fillRect(0,0,W,H);
  for(let pi=0;pi<normed.length;pi++){
    const pt=normed[pi];
    ctx.strokeStyle=hsl(pi,normed.length);ctx.lineWidth=1.5;
    ctx.beginPath();
    for(let d=0;d<DIMS;d++){
      const ax=pad.left+d*asp,ay=pad.top+(1-pt.values[d])*(H-pad.top-pad.bottom);
      d===0?ctx.moveTo(ax,ay):ctx.lineTo(ax,ay);
    }
    ctx.stroke();
  }
  for(let d=0;d<DIMS;d++){
    const ax=pad.left+d*asp;
    ctx.strokeStyle='#475569';ctx.lineWidth=2;
    ctx.beginPath();ctx.moveTo(ax,pad.top);ctx.lineTo(ax,H-pad.bottom);ctx.stroke();
    ctx.fillStyle='#94a3b8';ctx.font='11px monospace';ctx.textAlign='center';
    ctx.fillText(LABELS[d],ax,pad.top-8);
  }
  ctx.fillStyle='#e2e8f0';ctx.font='bold 13px sans-serif';ctx.textAlign='center';
  ctx.fillText(TITLE,W/2,18);
  ctx.fillStyle='#64748b';ctx.font='10px monospace';ctx.textAlign='right';
  ctx.fillText(DIMS+'D · '+N_PTS+' pts',W-10,H-6);
}

function drawScatter(){
  const W=canvas.width,H=canvas.height;
  const d=Math.min(DIMS,5);
  const pad=30,cW=(W-pad)/d,cH=(H-pad)/d;
  ctx.fillStyle='#0f172a';ctx.fillRect(0,0,W,H);
  for(let r=0;r<d;r++) for(let c=0;c<d;c++){
    const x0=pad+c*cW,y0=pad+r*cH;
    ctx.fillStyle='#0d1929';ctx.fillRect(x0+1,y0+1,cW-2,cH-2);
    if(r===c){
      ctx.fillStyle='#64748b';ctx.font='bold 10px monospace';ctx.textAlign='center';
      ctx.fillText(LABELS[c],x0+cW/2,y0+cH/2+4);
    } else {
      for(let pi=0;pi<normed.length;pi++){
        const pt=normed[pi];
        const px=x0+4+pt.values[c]*(cW-8),py=y0+cH-4-pt.values[r]*(cH-8);
        ctx.fillStyle=hsl(pi,normed.length);
        ctx.beginPath();ctx.arc(px,py,2,0,2*Math.PI);ctx.fill();
      }
    }
    ctx.strokeStyle='#1e293b';ctx.lineWidth=1;ctx.strokeRect(x0,y0,cW,cH);
  }
  ctx.fillStyle='#e2e8f0';ctx.font='bold 13px sans-serif';ctx.textAlign='center';ctx.fillText(TITLE,W/2,18);
}

function drawRadar(){
  const W=canvas.width,H=canvas.height,cx=W/2,cy=H/2;
  const R=Math.min(W,H)*0.35;
  ctx.fillStyle='#0f172a';ctx.fillRect(0,0,W,H);
  for(let ring=1;ring<=5;ring++){
    const r=ring/5*R;
    ctx.strokeStyle='#1e293b';ctx.lineWidth=1;ctx.beginPath();
    for(let d=0;d<DIMS;d++){const a=d/DIMS*2*Math.PI-Math.PI/2;const px=cx+r*Math.cos(a),py=cy+r*Math.sin(a);d===0?ctx.moveTo(px,py):ctx.lineTo(px,py);}
    ctx.closePath();ctx.stroke();
  }
  for(let d=0;d<DIMS;d++){
    const a=d/DIMS*2*Math.PI-Math.PI/2;
    ctx.strokeStyle='#475569';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(cx,cy);ctx.lineTo(cx+R*Math.cos(a),cy+R*Math.sin(a));ctx.stroke();
    ctx.fillStyle='#94a3b8';ctx.font='10px monospace';
    ctx.textAlign=Math.abs(Math.cos(a))<0.1?'center':Math.cos(a)>0?'left':'right';
    ctx.fillText(LABELS[d],cx+(R+18)*Math.cos(a),cy+(R+18)*Math.sin(a)+4);
  }
  for(let pi=0;pi<normed.length;pi++){
    const pt=normed[pi];
    ctx.strokeStyle=hsl(pi,normed.length);ctx.fillStyle=hsl(pi,normed.length).replace('0.7)','0.1)');ctx.lineWidth=1.5;
    ctx.beginPath();
    for(let d=0;d<DIMS;d++){const a=d/DIMS*2*Math.PI-Math.PI/2;const r=pt.values[d]*R;const px=cx+r*Math.cos(a),py=cy+r*Math.sin(a);d===0?ctx.moveTo(px,py):ctx.lineTo(px,py);}
    ctx.closePath();ctx.fill();ctx.stroke();
  }
  ctx.fillStyle='#e2e8f0';ctx.font='bold 13px sans-serif';ctx.textAlign='center';ctx.fillText(TITLE,W/2,18);
}

function draw(){
  if(mode==='parallel')drawParallel();
  else if(mode==='scatter')drawScatter();
  else drawRadar();
}

function setMode(m){
  mode=m;
  ['mParallel','mScatter','mRadar'].forEach(id=>document.getElementById(id).classList.remove('active'));
  document.getElementById('m'+m.charAt(0).toUpperCase()+m.slice(1)).classList.add('active');
  draw();
}

function resize(){
  canvas.width=canvas.offsetWidth*devicePixelRatio;
  const h=Math.min(450,Math.round(canvas.offsetWidth*0.65));
  canvas.height=h*devicePixelRatio;canvas.style.height=h+'px';
  draw();
}
new ResizeObserver(resize).observe(canvas);
resize();
</script>
</body>
</html>`;
}
