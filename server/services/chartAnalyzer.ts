/**
 * Chart Analyzer Service
 * 
 * Analyzes and describes charts/graphs in documents.
 * Uses image analysis to detect chart types and extract data patterns.
 * 
 * Note: For full accuracy, this would integrate with vision LLMs,
 * but this provides heuristic-based analysis.
 */

// =============================================================================
// Types
// =============================================================================

export interface ChartAnalysis {
    chartType: ChartType;
    confidence: number;
    description: string;
    detectedElements: ChartElement[];
    dataPatterns: DataPattern[];
    accessibilityDescription: string;
}

export type ChartType =
    | 'bar'
    | 'line'
    | 'pie'
    | 'scatter'
    | 'area'
    | 'histogram'
    | 'table'
    | 'unknown';

export interface ChartElement {
    type: 'title' | 'axis' | 'legend' | 'label' | 'data_point';
    content?: string;
    position?: { x: number; y: number };
}

export interface DataPattern {
    pattern: 'increasing' | 'decreasing' | 'stable' | 'fluctuating' | 'peak' | 'dip';
    description: string;
    confidence: number;
}

export interface AnalysisOptions {
    extractNumbers?: boolean;
    detectTrends?: boolean;
    generateDescription?: boolean;
}

// =============================================================================
// Chart Type Detection (Based on text/context clues)
// =============================================================================

const CHART_TYPE_INDICATORS: Record<ChartType, string[]> = {
    bar: ['bar chart', 'gráfico de barras', 'histogram', 'histograma', 'column chart', 'bar graph'],
    line: ['line chart', 'gráfico de líneas', 'trend line', 'línea de tendencia', 'line graph', 'time series'],
    pie: ['pie chart', 'gráfico circular', 'gráfico de pastel', 'pie graph', 'donut chart', 'gráfico de dona'],
    scatter: ['scatter plot', 'diagrama de dispersión', 'correlation', 'correlación', 'scatter chart'],
    area: ['area chart', 'gráfico de área', 'stacked area', 'área apilada'],
    histogram: ['histogram', 'histograma', 'distribution', 'distribución', 'frequency'],
    table: ['tabla', 'table', 'data table', 'cuadro', 'spreadsheet'],
    unknown: []
};

function detectChartTypeFromContext(text: string): { type: ChartType; confidence: number } {
    const lowerText = text.toLowerCase();

    for (const [chartType, indicators] of Object.entries(CHART_TYPE_INDICATORS) as [ChartType, string[]][]) {
        for (const indicator of indicators) {
            if (lowerText.includes(indicator)) {
                return { type: chartType, confidence: 0.8 };
            }
        }
    }

    // Heuristic detection based on number patterns
    const numbers = text.match(/\d+(?:\.\d+)?%?/g) || [];

    if (numbers.length > 0) {
        // Percentages often suggest pie charts
        const percentages = numbers.filter(n => n.includes('%'));
        if (percentages.length >= 3) {
            return { type: 'pie', confidence: 0.5 };
        }

        // Many numbers might suggest bar/line chart
        if (numbers.length >= 5) {
            return { type: 'bar', confidence: 0.4 };
        }
    }

    return { type: 'unknown', confidence: 0.2 };
}

// =============================================================================
// Number Extraction and Pattern Analysis
// =============================================================================

function extractNumbers(text: string): number[] {
    const matches = text.match(/\d+(?:,\d{3})*(?:\.\d+)?/g) || [];
    return matches.map(m => parseFloat(m.replace(/,/g, '')));
}

function analyzeDataPatterns(numbers: number[]): DataPattern[] {
    const patterns: DataPattern[] = [];

    if (numbers.length < 2) return patterns;

    // Calculate differences
    const diffs: number[] = [];
    for (let i = 1; i < numbers.length; i++) {
        diffs.push(numbers[i] - numbers[i - 1]);
    }

    // Check for increasing trend
    const increasingCount = diffs.filter(d => d > 0).length;
    const decreasingCount = diffs.filter(d => d < 0).length;
    const stableCount = diffs.filter(d => Math.abs(d) < (Math.max(...numbers) * 0.05)).length;

    if (increasingCount > diffs.length * 0.7) {
        patterns.push({
            pattern: 'increasing',
            description: 'Tendencia alcista general',
            confidence: increasingCount / diffs.length
        });
    } else if (decreasingCount > diffs.length * 0.7) {
        patterns.push({
            pattern: 'decreasing',
            description: 'Tendencia bajista general',
            confidence: decreasingCount / diffs.length
        });
    } else if (stableCount > diffs.length * 0.5) {
        patterns.push({
            pattern: 'stable',
            description: 'Valores relativamente estables',
            confidence: stableCount / diffs.length
        });
    } else {
        patterns.push({
            pattern: 'fluctuating',
            description: 'Valores con fluctuaciones',
            confidence: 0.6
        });
    }

    // Detect peaks and dips
    const max = Math.max(...numbers);
    const min = Math.min(...numbers);
    const range = max - min;

    if (range > 0) {
        const maxIdx = numbers.indexOf(max);
        const minIdx = numbers.indexOf(min);

        if (maxIdx !== 0 && maxIdx !== numbers.length - 1) {
            patterns.push({
                pattern: 'peak',
                description: `Punto máximo en posición ${maxIdx + 1} (valor: ${max})`,
                confidence: 0.8
            });
        }

        if (minIdx !== 0 && minIdx !== numbers.length - 1) {
            patterns.push({
                pattern: 'dip',
                description: `Punto mínimo en posición ${minIdx + 1} (valor: ${min})`,
                confidence: 0.8
            });
        }
    }

    return patterns;
}

// =============================================================================
// Main Analysis Function
// =============================================================================

export function analyzeChartFromText(
    text: string,
    options: AnalysisOptions = {}
): ChartAnalysis {
    const { extractNumbers: shouldExtractNumbers = true, detectTrends = true } = options;

    // Detect chart type
    const { type: chartType, confidence: typeConfidence } = detectChartTypeFromContext(text);

    // Extract elements
    const elements: ChartElement[] = [];

    // Look for title (often in first line or after "título:", "title:")
    const titleMatch = text.match(/(?:título|title|gráfico|chart|figura|figure)[:\s]+([^\n]+)/i);
    if (titleMatch) {
        elements.push({ type: 'title', content: titleMatch[1].trim() });
    }

    // Look for axis labels
    const axisPattern = /(?:eje|axis)\s*(?:x|y|horizontal|vertical)[:\s]+([^\n]+)/gi;
    let axisMatch;
    while ((axisMatch = axisPattern.exec(text)) !== null) {
        elements.push({ type: 'axis', content: axisMatch[1].trim() });
    }

    // Extract and analyze numbers
    const numbers = shouldExtractNumbers ? extractNumbers(text) : [];
    const dataPatterns = detectTrends && numbers.length > 0 ? analyzeDataPatterns(numbers) : [];

    // Generate description
    const description = generateChartDescription(chartType, elements, numbers, dataPatterns);

    // Generate accessibility description
    const accessibilityDescription = generateAccessibilityDescription(chartType, elements, numbers);

    return {
        chartType,
        confidence: typeConfidence,
        description,
        detectedElements: elements,
        dataPatterns,
        accessibilityDescription
    };
}

// =============================================================================
// Description Generators
// =============================================================================

function generateChartDescription(
    chartType: ChartType,
    elements: ChartElement[],
    numbers: number[],
    patterns: DataPattern[]
): string {
    const parts: string[] = [];

    // Chart type intro
    const typeNames: Record<ChartType, string> = {
        bar: 'gráfico de barras',
        line: 'gráfico de líneas',
        pie: 'gráfico circular',
        scatter: 'diagrama de dispersión',
        area: 'gráfico de área',
        histogram: 'histograma',
        table: 'tabla de datos',
        unknown: 'visualización de datos'
    };

    const title = elements.find(e => e.type === 'title')?.content;
    if (title) {
        parts.push(`Este ${typeNames[chartType]} titulado "${title}"`);
    } else {
        parts.push(`Este ${typeNames[chartType]}`);
    }

    // Add number summary
    if (numbers.length > 0) {
        const min = Math.min(...numbers);
        const max = Math.max(...numbers);
        const avg = numbers.reduce((a, b) => a + b, 0) / numbers.length;
        parts.push(`contiene ${numbers.length} valores de datos (rango: ${min.toFixed(1)} a ${max.toFixed(1)}, promedio: ${avg.toFixed(1)})`);
    }

    // Add pattern descriptions
    if (patterns.length > 0) {
        const mainPattern = patterns[0];
        parts.push(`. ${mainPattern.description}`);
    }

    return parts.join(' ').trim() + '.';
}

function generateAccessibilityDescription(
    chartType: ChartType,
    elements: ChartElement[],
    numbers: number[]
): string {
    const typeDescriptions: Record<ChartType, string> = {
        bar: 'Gráfico de barras que compara valores categóricos',
        line: 'Gráfico de líneas que muestra tendencias a lo largo del tiempo',
        pie: 'Gráfico circular que muestra proporciones de un total',
        scatter: 'Diagrama de dispersión que muestra relación entre dos variables',
        area: 'Gráfico de área que muestra volumen acumulado',
        histogram: 'Histograma que muestra distribución de frecuencias',
        table: 'Tabla que presenta datos organizados en filas y columnas',
        unknown: 'Visualización de datos'
    };

    let description = typeDescriptions[chartType];

    const title = elements.find(e => e.type === 'title')?.content;
    if (title) {
        description += `. Título: ${title}`;
    }

    if (numbers.length > 0) {
        description += `. Contiene ${numbers.length} puntos de datos con valores entre ${Math.min(...numbers)} y ${Math.max(...numbers)}`;
    }

    return description;
}

// =============================================================================
// Export
// =============================================================================

export const chartAnalyzer = {
    analyzeChartFromText,
    detectChartTypeFromContext,
    extractNumbers,
    analyzeDataPatterns
};

export default chartAnalyzer;
