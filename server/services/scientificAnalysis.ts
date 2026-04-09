/**
 * Scientific Analysis Service
 *
 * Detects scientific / engineering data-analysis requests from natural language
 * and generates ready-to-run Python code that leverages matplotlib, numpy and
 * scipy.  The generated code is designed to be executed via the `openclaw_exec`
 * tool (i.e. `python3 -c "..."` or by writing a temp script).
 *
 * Output conventions:
 *   - Charts are saved to `/tmp/iliagpt_chart.png` (150 dpi, tight bbox).
 *   - Numeric / tabular results are printed to stdout as JSON.
 */

import { createLogger } from "../utils/logger";

const log = createLogger("scientific-analysis");

// ─── Types ───────────────────────────────────────────────────────────────────

export type ScientificRequestType =
  | "chart_2d"
  | "chart_3d"
  | "curve_fit"
  | "statistics"
  | "signal_processing"
  | "data_analysis"
  | "regression";

export interface ScientificRequest {
  type: ScientificRequestType;
  description: string;
  data?: unknown;
}

// ─── Intent detection ────────────────────────────────────────────────────────

/**
 * Return a `ScientificRequest` if `message` looks like a scientific /
 * engineering analysis request, or `null` otherwise.
 *
 * Patterns are bilingual (English + Spanish) since the base product targets
 * both audiences.
 */
export function detectScientificIntent(message: string): ScientificRequest | null {
  const lower = message.toLowerCase();

  // Signal processing (checked before charts – "FFT plot" is signal first)
  if (/fft|fourier|filtro.*pasa|band.*pass|low.*pass|high.*pass|señal|signal.*process|wavelet|espectro|frecuencia|sampling|nyquist|convolu/i.test(lower)) {
    return { type: "signal_processing", description: message };
  }

  // Curve fitting / regression
  if (/ajust[ea].*curva|curve.*fit|regresi[oó]n|fitting|interpolaci[oó]n|polynomial.*fit|least.*squares|m[ií]nimos.*cuadrados|exponential.*fit|gaussian.*fit/i.test(lower)) {
    return { type: "curve_fit", description: message };
  }

  // Statistics
  if (/estad[ií]stic|anova|test.*t\b|t[\s-]test|chi.*cuadrad|chi.*square|correlaci[oó]n|correlation|desviaci[oó]n.*est[aá]ndar|standard.*deviation|media|mediana|median|percentil|percentile|shapiro|normali(dad|ty)|box.*plot|histograma|histogram|p[\s-]?val/i.test(lower)) {
    return { type: "statistics", description: message };
  }

  // 3D charts
  if (/3d|superficie|surface.*plot|contorno|contour|wireframe|mesh.*plot/i.test(lower)) {
    return { type: "chart_3d", description: message };
  }

  // 2D charts (broad — kept last among chart patterns)
  if (/gr[aá]fic[oa]|plot|chart|diagrama.*datos|scatter|dispersi[oó]n|barras|bar.*chart|l[ií]neas|line.*chart|pie.*chart|heatmap|mapa.*calor|polar|stem.*plot|box.*plot|violin/i.test(lower)) {
    return { type: "chart_2d", description: message };
  }

  return null;
}

// ─── Python code generators ──────────────────────────────────────────────────

/** Shared preamble for every generated script. */
const PYTHON_PREAMBLE = `import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
import json

# Professional styling
try:
    plt.style.use('seaborn-v0_8-whitegrid')
except Exception:
    try:
        plt.style.use('seaborn-whitegrid')
    except Exception:
        pass
plt.rcParams.update({
    'font.size': 11,
    'font.family': 'sans-serif',
    'axes.titlesize': 14,
    'axes.labelsize': 12,
    'figure.dpi': 100,
})
`;

const OUTPUT_PATH = "/tmp/iliagpt_chart.png";
const SAVE_LINE = `plt.tight_layout()
plt.savefig('${OUTPUT_PATH}', dpi=150, bbox_inches='tight')
print(json.dumps({"status": "ok", "file": "${OUTPUT_PATH}", "type": "__TYPE__"}))
`;

function saveLine(type: string): string {
  return SAVE_LINE.replace("__TYPE__", type);
}

// ── 2D charts ────────────────────────────────────────────────────────────────

function generateChart2DCode(description: string): string {
  return `${PYTHON_PREAMBLE}
# 2D Chart – description: ${sanitizeComment(description)}
x = np.linspace(0, 10, 100)
y = np.sin(x)
y2 = np.cos(x)

fig, ax = plt.subplots(figsize=(10, 6))
ax.plot(x, y, 'b-', linewidth=2, label='sin(x)')
ax.plot(x, y2, 'r--', linewidth=2, label='cos(x)')
ax.set_xlabel('X')
ax.set_ylabel('Y')
ax.set_title('Sample 2D Plot')
ax.legend(loc='best')
ax.grid(True, alpha=0.3)

${saveLine("chart_2d")}`;
}

// ── 3D charts ────────────────────────────────────────────────────────────────

function generateChart3DCode(description: string): string {
  return `${PYTHON_PREAMBLE}
from mpl_toolkits.mplot3d import Axes3D

# 3D Surface – description: ${sanitizeComment(description)}
x = np.linspace(-5, 5, 60)
y = np.linspace(-5, 5, 60)
X, Y = np.meshgrid(x, y)
Z = np.sin(np.sqrt(X**2 + Y**2))

fig = plt.figure(figsize=(10, 7))
ax = fig.add_subplot(111, projection='3d')
surf = ax.plot_surface(X, Y, Z, cmap='viridis', edgecolor='none', alpha=0.9)
fig.colorbar(surf, shrink=0.5, aspect=10)
ax.set_xlabel('X')
ax.set_ylabel('Y')
ax.set_zlabel('Z')
ax.set_title('3D Surface Plot')

${saveLine("chart_3d")}`;
}

// ── Curve fitting ────────────────────────────────────────────────────────────

function generateCurveFitCode(description: string): string {
  return `${PYTHON_PREAMBLE}
from scipy.optimize import curve_fit

# Curve Fitting – description: ${sanitizeComment(description)}
np.random.seed(42)
x_data = np.linspace(0, 10, 50)
y_data = 2.5 * np.sin(1.5 * x_data) + np.random.normal(0, 0.5, len(x_data))

def model(x, a, b):
    return a * np.sin(b * x)

popt, pcov = curve_fit(model, x_data, y_data, p0=[2, 1])
perr = np.sqrt(np.diag(pcov))
x_fit = np.linspace(0, 10, 200)
y_fit = model(x_fit, *popt)

fig, ax = plt.subplots(figsize=(10, 6))
ax.scatter(x_data, y_data, c='steelblue', s=30, alpha=0.7, label='Data')
ax.plot(x_fit, y_fit, 'r-', linewidth=2, label=f'Fit: {popt[0]:.3f}*sin({popt[1]:.3f}*x)')
ax.set_xlabel('X')
ax.set_ylabel('Y')
ax.set_title('Curve Fitting (Nonlinear Least Squares)')
ax.legend(loc='best')
ax.grid(True, alpha=0.3)

results = {
    "parameters": {"a": round(popt[0], 4), "b": round(popt[1], 4)},
    "std_errors": {"a": round(perr[0], 4), "b": round(perr[1], 4)},
    "r_squared": round(1 - np.sum((y_data - model(x_data, *popt))**2) / np.sum((y_data - np.mean(y_data))**2), 4),
}

${saveLine("curve_fit")}
print(json.dumps({"results": results}))
`;
}

// ── Statistics ───────────────────────────────────────────────────────────────

function generateStatisticsCode(description: string): string {
  return `${PYTHON_PREAMBLE}
from scipy import stats

# Statistical Analysis – description: ${sanitizeComment(description)}
np.random.seed(42)
data_a = np.random.normal(loc=50, scale=10, size=100)
data_b = np.random.normal(loc=55, scale=12, size=100)

desc_a = {
    "mean": round(float(np.mean(data_a)), 4),
    "std": round(float(np.std(data_a, ddof=1)), 4),
    "median": round(float(np.median(data_a)), 4),
    "min": round(float(np.min(data_a)), 4),
    "max": round(float(np.max(data_a)), 4),
    "n": len(data_a),
}
desc_b = {
    "mean": round(float(np.mean(data_b)), 4),
    "std": round(float(np.std(data_b, ddof=1)), 4),
    "median": round(float(np.median(data_b)), 4),
    "min": round(float(np.min(data_b)), 4),
    "max": round(float(np.max(data_b)), 4),
    "n": len(data_b),
}

t_stat, p_value = stats.ttest_ind(data_a, data_b)
shapiro_a = stats.shapiro(data_a)
shapiro_b = stats.shapiro(data_b)

fig, axes = plt.subplots(1, 2, figsize=(12, 5))
axes[0].hist(data_a, bins=15, alpha=0.7, color='steelblue', edgecolor='white', label='Group A')
axes[0].hist(data_b, bins=15, alpha=0.7, color='coral', edgecolor='white', label='Group B')
axes[0].set_title('Distribution Comparison')
axes[0].set_xlabel('Value')
axes[0].set_ylabel('Frequency')
axes[0].legend()

axes[1].boxplot([data_a, data_b], labels=['Group A', 'Group B'])
axes[1].set_title('Box Plot Comparison')
axes[1].set_ylabel('Value')

results = {
    "group_a": desc_a,
    "group_b": desc_b,
    "t_test": {"t_statistic": round(float(t_stat), 4), "p_value": round(float(p_value), 6)},
    "shapiro_a": {"statistic": round(float(shapiro_a.statistic), 4), "p_value": round(float(shapiro_a.pvalue), 6)},
    "shapiro_b": {"statistic": round(float(shapiro_b.statistic), 4), "p_value": round(float(shapiro_b.pvalue), 6)},
}

${saveLine("statistics")}
print(json.dumps({"results": results}))
`;
}

// ── Signal processing ────────────────────────────────────────────────────────

function generateSignalProcessingCode(description: string): string {
  return `${PYTHON_PREAMBLE}
from scipy import signal as sig
from scipy.fft import fft, fftfreq

# Signal Processing – description: ${sanitizeComment(description)}
fs = 1000  # Sampling frequency
t = np.arange(0, 1.0, 1/fs)
# Composite signal: 50 Hz + 120 Hz
clean = np.sin(2 * np.pi * 50 * t) + 0.5 * np.sin(2 * np.pi * 120 * t)
noise = clean + 0.8 * np.random.randn(len(t))

# FFT
N = len(noise)
yf = fft(noise)
xf = fftfreq(N, 1/fs)[:N//2]
magnitude = 2.0/N * np.abs(yf[:N//2])

# Low-pass Butterworth filter (cutoff = 80 Hz)
b, a = sig.butter(4, 80, btype='low', fs=fs)
filtered = sig.filtfilt(b, a, noise)

fig, axes = plt.subplots(3, 1, figsize=(10, 9))

axes[0].plot(t[:200], noise[:200], 'b-', alpha=0.7, label='Noisy signal')
axes[0].set_title('Time Domain (Noisy)')
axes[0].set_xlabel('Time [s]')
axes[0].set_ylabel('Amplitude')
axes[0].legend()

axes[1].plot(xf, magnitude, 'r-', linewidth=1)
axes[1].set_title('Frequency Domain (FFT)')
axes[1].set_xlabel('Frequency [Hz]')
axes[1].set_ylabel('Magnitude')
axes[1].set_xlim(0, 200)

axes[2].plot(t[:200], filtered[:200], 'g-', linewidth=2, label='Filtered (LP 80 Hz)')
axes[2].plot(t[:200], clean[:200], 'k--', alpha=0.5, label='Original clean')
axes[2].set_title('After Low-Pass Filter')
axes[2].set_xlabel('Time [s]')
axes[2].set_ylabel('Amplitude')
axes[2].legend()

results = {
    "sampling_rate_hz": fs,
    "signal_duration_s": float(t[-1]),
    "dominant_frequencies_hz": [50, 120],
    "filter": {"type": "butterworth", "order": 4, "cutoff_hz": 80},
}

${saveLine("signal_processing")}
print(json.dumps({"results": results}))
`;
}

// ── Generic data analysis ────────────────────────────────────────────────────

function generateDataAnalysisCode(description: string): string {
  return `${PYTHON_PREAMBLE}
# General Data Analysis – description: ${sanitizeComment(description)}
np.random.seed(42)
n = 200
x = np.random.randn(n)
y = 2.5 * x + np.random.randn(n) * 0.8

correlation = round(float(np.corrcoef(x, y)[0, 1]), 4)

fig, axes = plt.subplots(1, 2, figsize=(12, 5))
axes[0].scatter(x, y, c='steelblue', s=20, alpha=0.6)
z = np.polyfit(x, y, 1)
p = np.poly1d(z)
x_line = np.linspace(x.min(), x.max(), 100)
axes[0].plot(x_line, p(x_line), 'r-', linewidth=2, label=f'y = {z[0]:.2f}x + {z[1]:.2f}')
axes[0].set_xlabel('X')
axes[0].set_ylabel('Y')
axes[0].set_title(f'Scatter + Linear Fit (r={correlation})')
axes[0].legend()

axes[1].hist(y, bins=20, color='steelblue', edgecolor='white', alpha=0.8)
axes[1].set_xlabel('Y value')
axes[1].set_ylabel('Count')
axes[1].set_title('Distribution of Y')

results = {
    "correlation": correlation,
    "linear_fit": {"slope": round(float(z[0]), 4), "intercept": round(float(z[1]), 4)},
    "n_samples": n,
}

${saveLine("data_analysis")}
print(json.dumps({"results": results}))
`;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Generate a self-contained Python script for the given scientific request.
 * The script can be executed with `python3 <file>` and will:
 *   1. Create a publication-quality chart at `/tmp/iliagpt_chart.png`.
 *   2. Print a JSON summary to stdout.
 */
export function generatePythonForAnalysis(request: ScientificRequest): string {
  log.info(`Generating Python for ${request.type}`, { type: request.type });

  switch (request.type) {
    case "chart_2d":
      return generateChart2DCode(request.description);
    case "chart_3d":
      return generateChart3DCode(request.description);
    case "curve_fit":
      return generateCurveFitCode(request.description);
    case "statistics":
      return generateStatisticsCode(request.description);
    case "signal_processing":
      return generateSignalProcessingCode(request.description);
    case "regression":
      return generateCurveFitCode(request.description); // alias
    case "data_analysis":
    default:
      return generateDataAnalysisCode(request.description);
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Strip newlines and hash chars to keep a description safe inside a Python comment. */
function sanitizeComment(text: string): string {
  return text.replace(/[\n\r#]/g, " ").slice(0, 120);
}
