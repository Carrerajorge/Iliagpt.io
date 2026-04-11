/**
 * Minimal Float64Array-backed matrix library for the Transformer primitives.
 *
 * Zero dependencies. Row-major storage (so `m.data[i * cols + j]` is the
 * element at row `i`, column `j`). All operations return NEW matrices; we
 * never mutate the inputs. The goal is clarity + numerical correctness,
 * not raw performance — the attention / rerank paths run on small matrices
 * (seq_len ≤ 256, d_model ≤ 512) where O(n^3) matmul is fine.
 *
 * References used throughout this file (Vaswani et al. 2017, "Attention Is
 * All You Need"):
 *   - Eq (1): Attention(Q,K,V) = softmax(QK^T / sqrt(d_k)) V
 *   - Eq (2): FFN(x) = max(0, xW1 + b1) W2 + b2
 *   - Section 3.5: sinusoidal positional encoding
 */

export interface Matrix {
  readonly rows: number;
  readonly cols: number;
  readonly data: Float64Array; // length = rows * cols
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

export function create(rows: number, cols: number, fill = 0): Matrix {
  if (rows < 0 || cols < 0 || !Number.isInteger(rows) || !Number.isInteger(cols)) {
    throw new Error(`Matrix.create: invalid shape ${rows}x${cols}`);
  }
  const data = new Float64Array(rows * cols);
  if (fill !== 0) data.fill(fill);
  return { rows, cols, data };
}

export function zeros(rows: number, cols: number): Matrix {
  return create(rows, cols, 0);
}

export function ones(rows: number, cols: number): Matrix {
  return create(rows, cols, 1);
}

export function identity(n: number): Matrix {
  const m = zeros(n, n);
  for (let i = 0; i < n; i++) m.data[i * n + i] = 1;
  return m;
}

export function fromArray(arr: number[][]): Matrix {
  const rows = arr.length;
  const cols = rows > 0 ? arr[0].length : 0;
  const m = zeros(rows, cols);
  for (let i = 0; i < rows; i++) {
    if (arr[i].length !== cols) {
      throw new Error(`Matrix.fromArray: row ${i} has length ${arr[i].length}, expected ${cols}`);
    }
    for (let j = 0; j < cols; j++) {
      m.data[i * cols + j] = arr[i][j];
    }
  }
  return m;
}

export function toArray(m: Matrix): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < m.rows; i++) {
    const row: number[] = [];
    for (let j = 0; j < m.cols; j++) row.push(m.data[i * m.cols + j]);
    out.push(row);
  }
  return out;
}

/** Deterministic "xavier-like" init used by tests. Seedable so runs are reproducible. */
export function xavier(rows: number, cols: number, seed = 42): Matrix {
  const m = zeros(rows, cols);
  const scale = Math.sqrt(6 / (rows + cols));
  let state = seed;
  const rand = () => {
    // Mulberry32: tiny deterministic PRNG — good enough for test fixtures.
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = 0; i < rows * cols; i++) {
    m.data[i] = (rand() * 2 - 1) * scale;
  }
  return m;
}

// ---------------------------------------------------------------------------
// Element access helpers
// ---------------------------------------------------------------------------

export function get(m: Matrix, row: number, col: number): number {
  return m.data[row * m.cols + col];
}

export function set(m: Matrix, row: number, col: number, value: number): void {
  m.data[row * m.cols + col] = value;
}

// ---------------------------------------------------------------------------
// Basic ops
// ---------------------------------------------------------------------------

export function transpose(m: Matrix): Matrix {
  const out = zeros(m.cols, m.rows);
  for (let i = 0; i < m.rows; i++) {
    for (let j = 0; j < m.cols; j++) {
      out.data[j * m.rows + i] = m.data[i * m.cols + j];
    }
  }
  return out;
}

export function matmul(a: Matrix, b: Matrix): Matrix {
  if (a.cols !== b.rows) {
    throw new Error(`matmul: incompatible shapes ${a.rows}x${a.cols} · ${b.rows}x${b.cols}`);
  }
  const out = zeros(a.rows, b.cols);
  // Classic triple loop with inner-k for locality.
  for (let i = 0; i < a.rows; i++) {
    for (let k = 0; k < a.cols; k++) {
      const aik = a.data[i * a.cols + k];
      if (aik === 0) continue;
      for (let j = 0; j < b.cols; j++) {
        out.data[i * b.cols + j] += aik * b.data[k * b.cols + j];
      }
    }
  }
  return out;
}

export function add(a: Matrix, b: Matrix): Matrix {
  if (a.rows !== b.rows || a.cols !== b.cols) {
    throw new Error(`add: shape mismatch ${a.rows}x${a.cols} vs ${b.rows}x${b.cols}`);
  }
  const out = zeros(a.rows, a.cols);
  for (let i = 0; i < a.data.length; i++) out.data[i] = a.data[i] + b.data[i];
  return out;
}

/** Broadcast-add a bias row vector (shape 1xC) to each row of m. */
export function addBias(m: Matrix, bias: Matrix): Matrix {
  if (bias.rows !== 1 || bias.cols !== m.cols) {
    throw new Error(`addBias: bias must be 1x${m.cols}, got ${bias.rows}x${bias.cols}`);
  }
  const out = zeros(m.rows, m.cols);
  for (let i = 0; i < m.rows; i++) {
    for (let j = 0; j < m.cols; j++) {
      out.data[i * m.cols + j] = m.data[i * m.cols + j] + bias.data[j];
    }
  }
  return out;
}

export function scale(m: Matrix, s: number): Matrix {
  const out = zeros(m.rows, m.cols);
  for (let i = 0; i < m.data.length; i++) out.data[i] = m.data[i] * s;
  return out;
}

/** Element-wise ReLU. */
export function relu(m: Matrix): Matrix {
  const out = zeros(m.rows, m.cols);
  for (let i = 0; i < m.data.length; i++) {
    out.data[i] = m.data[i] > 0 ? m.data[i] : 0;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Softmax (row-wise, numerically stable)
// ---------------------------------------------------------------------------

/**
 * Row-wise softmax with max subtraction for numerical stability. Applied to
 * each row independently — the most common usage in attention (softmax over
 * keys per query).
 *
 *   softmax(x)_i = exp(x_i - max(x)) / sum_j exp(x_j - max(x))
 */
export function softmax(m: Matrix): Matrix {
  const out = zeros(m.rows, m.cols);
  for (let i = 0; i < m.rows; i++) {
    // 1. Find the row max for numerical stability.
    let rowMax = -Infinity;
    for (let j = 0; j < m.cols; j++) {
      const v = m.data[i * m.cols + j];
      if (v > rowMax) rowMax = v;
    }
    // 2. Exponentiate shifted values and accumulate the sum.
    let sum = 0;
    for (let j = 0; j < m.cols; j++) {
      const e = Math.exp(m.data[i * m.cols + j] - rowMax);
      out.data[i * m.cols + j] = e;
      sum += e;
    }
    // 3. Normalize. If the entire row was -Infinity (masked out), sum === 0
    //    after exp → we write zeros, which is the safest interpretation
    //    (nothing to attend to).
    if (sum > 0) {
      for (let j = 0; j < m.cols; j++) {
        out.data[i * m.cols + j] /= sum;
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Layer normalization
// ---------------------------------------------------------------------------

/**
 * LayerNorm across the feature dimension (last dim).
 *
 *   LN(x) = gamma * (x - mean) / sqrt(var + eps) + beta
 *
 * `gamma` and `beta` default to 1 and 0 (identity scale / shift), which is
 * the unscaled vanilla layer norm used by the paper's reference model when
 * the learnable parameters are at their initial values.
 */
export function layerNorm(
  m: Matrix,
  gamma?: Float64Array,
  beta?: Float64Array,
  eps = 1e-5,
): Matrix {
  if (gamma && gamma.length !== m.cols) {
    throw new Error(`layerNorm: gamma length ${gamma.length} != cols ${m.cols}`);
  }
  if (beta && beta.length !== m.cols) {
    throw new Error(`layerNorm: beta length ${beta.length} != cols ${m.cols}`);
  }
  const out = zeros(m.rows, m.cols);
  for (let i = 0; i < m.rows; i++) {
    let mean = 0;
    for (let j = 0; j < m.cols; j++) mean += m.data[i * m.cols + j];
    mean /= m.cols;

    let variance = 0;
    for (let j = 0; j < m.cols; j++) {
      const d = m.data[i * m.cols + j] - mean;
      variance += d * d;
    }
    variance /= m.cols;

    const invStd = 1 / Math.sqrt(variance + eps);
    for (let j = 0; j < m.cols; j++) {
      const normalized = (m.data[i * m.cols + j] - mean) * invStd;
      const g = gamma ? gamma[j] : 1;
      const b = beta ? beta[j] : 0;
      out.data[i * m.cols + j] = g * normalized + b;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Masking helpers
// ---------------------------------------------------------------------------

/**
 * Apply a boolean mask to a score matrix IN PLACE: entries where mask[i][j]
 * is `false` are set to -Infinity so softmax maps them to 0. Used by the
 * decoder's masked self-attention to prevent leftward information flow,
 * and by the encoder's padding mask to ignore pad tokens.
 *
 * Mask shape must match the matrix exactly.
 */
export function applyMask(m: Matrix, mask: boolean[][]): Matrix {
  if (mask.length !== m.rows) {
    throw new Error(`applyMask: mask rows ${mask.length} != matrix rows ${m.rows}`);
  }
  const out = zeros(m.rows, m.cols);
  out.data.set(m.data);
  for (let i = 0; i < m.rows; i++) {
    if (mask[i].length !== m.cols) {
      throw new Error(`applyMask: mask row ${i} length ${mask[i].length} != cols ${m.cols}`);
    }
    for (let j = 0; j < m.cols; j++) {
      if (!mask[i][j]) {
        out.data[i * m.cols + j] = -Infinity;
      }
    }
  }
  return out;
}

/**
 * Build a lower-triangular causal mask of size `n x n`. Used by the decoder
 * to prevent each position from attending to subsequent positions.
 *
 *   causalMask(3) = [[true,  false, false],
 *                    [true,  true,  false],
 *                    [true,  true,  true ]]
 */
export function causalMask(n: number): boolean[][] {
  const out: boolean[][] = [];
  for (let i = 0; i < n; i++) {
    const row: boolean[] = [];
    for (let j = 0; j < n; j++) row.push(j <= i);
    out.push(row);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Row / column slicing
// ---------------------------------------------------------------------------

export function sliceRows(m: Matrix, start: number, end: number): Matrix {
  const out = zeros(end - start, m.cols);
  for (let i = start; i < end; i++) {
    for (let j = 0; j < m.cols; j++) {
      out.data[(i - start) * m.cols + j] = m.data[i * m.cols + j];
    }
  }
  return out;
}

export function sliceCols(m: Matrix, start: number, end: number): Matrix {
  const out = zeros(m.rows, end - start);
  for (let i = 0; i < m.rows; i++) {
    for (let j = start; j < end; j++) {
      out.data[i * (end - start) + (j - start)] = m.data[i * m.cols + j];
    }
  }
  return out;
}

/** Horizontal concatenation along the column axis. Used by multi-head attention. */
export function concatCols(matrices: Matrix[]): Matrix {
  if (matrices.length === 0) return zeros(0, 0);
  const rows = matrices[0].rows;
  for (const m of matrices) {
    if (m.rows !== rows) throw new Error(`concatCols: row mismatch`);
  }
  const cols = matrices.reduce((n, m) => n + m.cols, 0);
  const out = zeros(rows, cols);
  for (let i = 0; i < rows; i++) {
    let colOffset = 0;
    for (const m of matrices) {
      for (let j = 0; j < m.cols; j++) {
        out.data[i * cols + colOffset + j] = m.data[i * m.cols + j];
      }
      colOffset += m.cols;
    }
  }
  return out;
}
