declare module 'xlsx-chart' {
  interface ChartOptions {
    file?: string;
    chart: 'column' | 'bar' | 'line' | 'area' | 'radar' | 'scatter' | 'pie';
    titles: string[];
    fields: string[];
    data: Record<string, Record<string, number>>;
    chartTitle?: string;
  }

  class XLSXChart {
    generate(opts: ChartOptions, callback: (err: Error | null, data: Buffer) => void): void;
    writeFile(opts: ChartOptions, callback: (err: Error | null) => void): void;
  }

  export = XLSXChart;
}
