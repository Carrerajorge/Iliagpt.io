import { Logger } from '../../lib/logger';

// ─── Shared chunk types ────────────────────────────────────────────────────────

interface RetrievedChunk {
  id: string;
  documentId: string;
  content: string;
  chunkIndex: number;
  metadata: Record<string, unknown>;
  tokens: number;
  score: number;
  source: string;
  retrievalMethod: string;
}

export interface RankedChunk extends RetrievedChunk {
  rank: number;
  rerankScore?: number;
}

// ─── Public types ─────────────────────────────────────────────────────────────

export interface TableCell {
  row: number;
  col: number;
  value: string;
  isHeader: boolean;
}

export interface ParsedTable {
  id: string;
  sourceChunkId: string;
  headers: string[];
  rows: string[][];
  cells: TableCell[];
  caption?: string;
  rowCount: number;
  colCount: number;
}

export interface TableQuery {
  type: 'lookup' | 'aggregate' | 'filter' | 'compare' | 'describe';
  targetColumn?: string;
  condition?: string;
  aggregation?: 'sum' | 'avg' | 'min' | 'max' | 'count';
}

export interface TableResult {
  table: ParsedTable;
  matchedCells: TableCell[];
  summary: string;
  formattedTable: string;
  queryType: TableQuery['type'];
}

export interface TableAwareConfig {
  maxTables: number;
  includeCaption: boolean;
  cellReferenceFormat: 'A1' | 'row,col';
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

let tableIdCounter = 0;

function nextTableId(): string {
  tableIdCounter++;
  return `tbl-${tableIdCounter}`;
}

function colIndexToLetter(col: number): string {
  // col is 0-based; returns A, B, ..., Z, AA, AB, ...
  let result = '';
  let n = col + 1;
  while (n > 0) {
    const remainder = (n - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    n = Math.floor((n - 1) / 26);
  }
  return result;
}

// ─── TableAwareGenerator ──────────────────────────────────────────────────────

export class TableAwareGenerator {
  private readonly config: TableAwareConfig;

  constructor(config?: Partial<TableAwareConfig>) {
    this.config = {
      maxTables: 20,
      includeCaption: true,
      cellReferenceFormat: 'row,col',
      ...config,
    };
  }

  extractTables(chunks: RankedChunk[]): ParsedTable[] {
    const tables: ParsedTable[] = [];

    for (const chunk of chunks) {
      if (tables.length >= this.config.maxTables) {
        Logger.warn('[TableAwareGenerator] Max tables limit reached', {
          maxTables: this.config.maxTables,
          processedChunks: chunks.indexOf(chunk),
        });
        break;
      }

      const tableBlocks = this._detectTableInChunk(chunk.content);

      for (const block of tableBlocks) {
        if (tables.length >= this.config.maxTables) break;

        const parsed = this._parseMarkdownTable(block.raw, chunk.id);
        if (parsed) {
          tables.push(parsed);
          Logger.debug('[TableAwareGenerator] Table extracted', {
            tableId: parsed.id,
            chunkId: chunk.id,
            rowCount: parsed.rowCount,
            colCount: parsed.colCount,
          });
        }
      }
    }

    Logger.info('[TableAwareGenerator] Table extraction complete', {
      chunkCount: chunks.length,
      tablesFound: tables.length,
    });

    return tables;
  }

  private _parseMarkdownTable(raw: string, sourceChunkId: string): ParsedTable | null {
    const lines = raw
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    if (lines.length < 2) return null;

    // Find header row (first line with |)
    const headerLineIdx = lines.findIndex((l) => l.includes('|'));
    if (headerLineIdx === -1) return null;

    // Find separator row (line with |---|)
    const separatorIdx = lines.findIndex(
      (l, i) => i > headerLineIdx && /^\|[\s\-|:]+\|$/.test(l),
    );
    if (separatorIdx === -1) return null;

    // Parse headers
    const headerLine = lines[headerLineIdx];
    const headers = headerLine
      .split('|')
      .map((h) => h.trim())
      .filter((h) => h.length > 0);

    if (headers.length === 0) return null;

    const colCount = headers.length;

    // Parse data rows (everything after the separator row that contains |)
    const dataLines = lines.slice(separatorIdx + 1).filter((l) => l.includes('|'));
    const rows: string[][] = [];

    for (const line of dataLines) {
      const cells = line
        .split('|')
        .map((c) => c.trim())
        .filter((_, idx, arr) =>
          // Remove empty leading/trailing empty cells from pipe-bordered rows
          idx > 0 || arr[0] !== '',
        );

      // Normalize: pad or trim to colCount
      const normalizedCells = headers.map((_, colIdx) => cells[colIdx] ?? '');
      rows.push(normalizedCells);
    }

    // Extract caption from line immediately before the table if it doesn't contain |
    let caption: string | undefined;
    if (this.config.includeCaption) {
      // Check for caption pattern: a line ending in ':' or starting with 'Table'
      const rawLines = raw.split('\n');
      const firstPipeLine = rawLines.findIndex((l) => l.includes('|'));
      if (firstPipeLine > 0) {
        const candidateLine = rawLines[firstPipeLine - 1].trim();
        if (
          candidateLine.length > 0 &&
          !candidateLine.includes('|') &&
          (candidateLine.endsWith(':') || /^table\s/i.test(candidateLine))
        ) {
          caption = candidateLine.replace(/:$/, '').trim();
        }
      }
    }

    // Build cells array
    const cells: TableCell[] = [];

    // Header cells at row 0
    headers.forEach((value, colIdx) => {
      cells.push({ row: 0, col: colIdx, value, isHeader: true });
    });

    // Data cells at row 1+
    rows.forEach((rowData, rowIdx) => {
      rowData.forEach((value, colIdx) => {
        cells.push({ row: rowIdx + 1, col: colIdx, value, isHeader: false });
      });
    });

    return {
      id: nextTableId(),
      sourceChunkId,
      headers,
      rows,
      cells,
      caption,
      rowCount: rows.length,
      colCount,
    };
  }

  queryTable(table: ParsedTable, query: TableQuery): TableResult {
    switch (query.type) {
      case 'lookup':
        return this._handleLookup(table, query);
      case 'filter':
        return this._handleFilter(table, query);
      case 'aggregate':
        return this._handleAggregate(table, query);
      case 'compare':
        return this._handleCompare(table, query);
      case 'describe':
        return this._handleDescribe(table, query);
      default: {
        const exhaustive: never = query.type;
        Logger.warn('[TableAwareGenerator] Unknown query type', { type: exhaustive });
        return this._handleDescribe(table, query);
      }
    }
  }

  private _getColumnIndex(table: ParsedTable, columnName: string): number {
    const lowerName = columnName.toLowerCase();
    return table.headers.findIndex(
      (h) => h.toLowerCase() === lowerName || h.toLowerCase().includes(lowerName),
    );
  }

  private _handleLookup(table: ParsedTable, query: TableQuery): TableResult {
    const matchedCells: TableCell[] = [];

    if (!query.condition) {
      return {
        table,
        matchedCells: [],
        summary: 'No condition provided for lookup.',
        formattedTable: this.formatTable(table),
        queryType: 'lookup',
      };
    }

    const colIdx = query.targetColumn
      ? this._getColumnIndex(table, query.targetColumn)
      : -1;
    const conditionLower = query.condition.toLowerCase();

    for (const cell of table.cells) {
      if (cell.isHeader) continue;
      if (colIdx !== -1 && cell.col !== colIdx) continue;
      if (cell.value.toLowerCase().includes(conditionLower)) {
        matchedCells.push(cell);
        // Also include the whole row for context
        const rowCells = table.cells.filter(
          (c) => c.row === cell.row && !c.isHeader,
        );
        for (const rc of rowCells) {
          if (!matchedCells.includes(rc)) matchedCells.push(rc);
        }
      }
    }

    const uniqueRows = [...new Set(matchedCells.filter((c) => !c.isHeader).map((c) => c.row))];
    const summary = matchedCells.length > 0
      ? `Found ${uniqueRows.length} row(s) matching "${query.condition}"${query.targetColumn ? ` in column "${query.targetColumn}"` : ''}.`
      : `No cells found matching "${query.condition}".`;

    return {
      table,
      matchedCells,
      summary,
      formattedTable: this.formatTable(table, matchedCells),
      queryType: 'lookup',
    };
  }

  private _handleFilter(table: ParsedTable, query: TableQuery): TableResult {
    if (!query.targetColumn || !query.condition) {
      return {
        table,
        matchedCells: [],
        summary: 'targetColumn and condition are required for filter.',
        formattedTable: this.formatTable(table),
        queryType: 'filter',
      };
    }

    const colIdx = this._getColumnIndex(table, query.targetColumn);
    if (colIdx === -1) {
      return {
        table,
        matchedCells: [],
        summary: `Column "${query.targetColumn}" not found in table.`,
        formattedTable: this.formatTable(table),
        queryType: 'filter',
      };
    }

    const conditionLower = query.condition.toLowerCase();
    const matchedRows: number[] = [];

    for (const row of table.rows) {
      const cellValue = (row[colIdx] ?? '').toLowerCase();
      if (cellValue.includes(conditionLower)) {
        const rowIndex = table.rows.indexOf(row) + 1; // +1 for header offset
        matchedRows.push(rowIndex);
      }
    }

    const matchedCells: TableCell[] = table.cells.filter(
      (c) => !c.isHeader && matchedRows.includes(c.row),
    );

    // Build filtered table for display
    const filteredRows = matchedRows.map((r) => table.rows[r - 1]);
    const filteredTable: ParsedTable = {
      ...table,
      id: `${table.id}-filtered`,
      rows: filteredRows,
      cells: [
        ...table.cells.filter((c) => c.isHeader),
        ...matchedCells,
      ],
      rowCount: filteredRows.length,
    };

    const summary = `Filtered to ${matchedRows.length} row(s) where "${query.targetColumn}" contains "${query.condition}".`;

    return {
      table: filteredTable,
      matchedCells,
      summary,
      formattedTable: this.formatTable(filteredTable, matchedCells),
      queryType: 'filter',
    };
  }

  private _handleAggregate(table: ParsedTable, query: TableQuery): TableResult {
    if (!query.targetColumn || !query.aggregation) {
      return {
        table,
        matchedCells: [],
        summary: 'targetColumn and aggregation are required for aggregate.',
        formattedTable: this.formatTable(table),
        queryType: 'aggregate',
      };
    }

    const colIdx = this._getColumnIndex(table, query.targetColumn);
    if (colIdx === -1) {
      return {
        table,
        matchedCells: [],
        summary: `Column "${query.targetColumn}" not found.`,
        formattedTable: this.formatTable(table),
        queryType: 'aggregate',
      };
    }

    const numericValues: number[] = [];
    const columnCells: TableCell[] = [];

    for (const cell of table.cells) {
      if (cell.isHeader || cell.col !== colIdx) continue;
      columnCells.push(cell);
      const num = parseFloat(cell.value.replace(/,/g, ''));
      if (!isNaN(num)) {
        numericValues.push(num);
      }
    }

    let result: number;
    let summary: string;

    if (query.aggregation === 'count') {
      result = columnCells.length;
      summary = `Count of "${query.targetColumn}": ${result} rows.`;
    } else if (numericValues.length === 0) {
      return {
        table,
        matchedCells: columnCells,
        summary: `No numeric values found in column "${query.targetColumn}".`,
        formattedTable: this.formatTable(table, columnCells),
        queryType: 'aggregate',
      };
    } else {
      switch (query.aggregation) {
        case 'sum':
          result = numericValues.reduce((a, b) => a + b, 0);
          summary = `Sum of "${query.targetColumn}": ${result.toLocaleString()}.`;
          break;
        case 'avg':
          result = numericValues.reduce((a, b) => a + b, 0) / numericValues.length;
          summary = `Average of "${query.targetColumn}": ${result.toFixed(2)}.`;
          break;
        case 'min':
          result = Math.min(...numericValues);
          summary = `Minimum of "${query.targetColumn}": ${result}.`;
          break;
        case 'max':
          result = Math.max(...numericValues);
          summary = `Maximum of "${query.targetColumn}": ${result}.`;
          break;
        default: {
          const exhaustive: never = query.aggregation;
          result = 0;
          summary = `Unknown aggregation: ${exhaustive}`;
        }
      }
    }

    return {
      table,
      matchedCells: columnCells,
      summary,
      formattedTable: this.formatTable(table, columnCells),
      queryType: 'aggregate',
    };
  }

  private _handleCompare(table: ParsedTable, query: TableQuery): TableResult {
    if (!query.targetColumn) {
      return {
        table,
        matchedCells: [],
        summary: 'targetColumn is required for compare.',
        formattedTable: this.formatTable(table),
        queryType: 'compare',
      };
    }

    const colIdx = this._getColumnIndex(table, query.targetColumn);
    if (colIdx === -1) {
      return {
        table,
        matchedCells: [],
        summary: `Column "${query.targetColumn}" not found.`,
        formattedTable: this.formatTable(table),
        queryType: 'compare',
      };
    }

    // Collect all rows with their value in the target column
    const rowValues: Array<{ rowIdx: number; rawValue: string; numericValue: number | null }> =
      table.rows.map((row, rowIdx) => {
        const rawValue = row[colIdx] ?? '';
        const numericValue = parseFloat(rawValue.replace(/,/g, ''));
        return { rowIdx, rawValue, numericValue: isNaN(numericValue) ? null : numericValue };
      });

    // Sort: numeric first (descending), then text alphabetically
    const hasNumeric = rowValues.some((r) => r.numericValue !== null);
    const sorted = [...rowValues].sort((a, b) => {
      if (hasNumeric) {
        const numA = a.numericValue ?? -Infinity;
        const numB = b.numericValue ?? -Infinity;
        return numB - numA;
      }
      return a.rawValue.localeCompare(b.rawValue);
    });

    // Build sorted rows
    const sortedRows = sorted.map((r) => table.rows[r.rowIdx]);
    const sortedTable: ParsedTable = {
      ...table,
      id: `${table.id}-compared`,
      rows: sortedRows,
      rowCount: sortedRows.length,
      cells: [
        ...table.cells.filter((c) => c.isHeader),
        ...sorted.flatMap((r, newRowIdx) =>
          table.headers.map((_, colIndex) => ({
            row: newRowIdx + 1,
            col: colIndex,
            value: table.rows[r.rowIdx][colIndex] ?? '',
            isHeader: false,
          })),
        ),
      ],
    };

    const columnCells = table.cells.filter((c) => !c.isHeader && c.col === colIdx);
    const summary = `Compared ${table.rowCount} rows by "${query.targetColumn}", sorted ${hasNumeric ? 'numerically descending' : 'alphabetically'}.`;

    return {
      table: sortedTable,
      matchedCells: columnCells,
      summary,
      formattedTable: this.formatTable(sortedTable, columnCells),
      queryType: 'compare',
    };
  }

  private _handleDescribe(table: ParsedTable, _query: TableQuery): TableResult {
    const columnTypes = this._inferColumnTypes(table);
    const typeDescriptions = table.headers
      .map((h) => `${h} (${columnTypes[h] ?? 'unknown'})`)
      .join(', ');

    const summary = [
      `Table has ${table.rowCount} data row(s) and ${table.colCount} column(s).`,
      `Columns: ${typeDescriptions}.`,
      table.caption ? `Caption: ${table.caption}.` : '',
    ]
      .filter((s) => s.length > 0)
      .join(' ');

    return {
      table,
      matchedCells: [],
      summary,
      formattedTable: this.formatTable(table),
      queryType: 'describe',
    };
  }

  formatTable(table: ParsedTable, highlightCells?: TableCell[]): string {
    const highlightSet = new Set(
      (highlightCells ?? []).map((c) => `${c.row},${c.col}`),
    );

    const formatCell = (value: string, row: number, col: number): string => {
      const key = `${row},${col}`;
      return highlightSet.has(key) ? `**${value}**` : value;
    };

    const lines: string[] = [];

    // Caption
    if (this.config.includeCaption && table.caption) {
      lines.push(`*${table.caption}*`);
      lines.push('');
    }

    // Header row
    const headerCells = table.headers.map((h, col) => formatCell(h, 0, col));
    lines.push(`| ${headerCells.join(' | ')} |`);

    // Separator
    lines.push(`| ${table.headers.map(() => '---').join(' | ')} |`);

    // Data rows
    for (let rowIdx = 0; rowIdx < table.rows.length; rowIdx++) {
      const row = table.rows[rowIdx];
      const cells = table.headers.map((_, col) =>
        formatCell(row[col] ?? '', rowIdx + 1, col),
      );
      lines.push(`| ${cells.join(' | ')} |`);
    }

    return lines.join('\n');
  }

  cellReference(cell: TableCell): string {
    if (this.config.cellReferenceFormat === 'A1') {
      const colLetter = colIndexToLetter(cell.col);
      const rowNum = cell.row + 1; // 1-based
      return `${colLetter}${rowNum}`;
    }
    return `${cell.row},${cell.col}`;
  }

  private _detectTableInChunk(
    content: string,
  ): Array<{ start: number; end: number; raw: string }> {
    const lines = content.split('\n');
    const results: Array<{ start: number; end: number; raw: string }> = [];

    let tableStart = -1;
    let consecutivePipeLines = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const hasPipe = line.includes('|');

      if (hasPipe) {
        if (tableStart === -1) tableStart = i;
        consecutivePipeLines++;
      } else {
        if (consecutivePipeLines >= 3 && tableStart !== -1) {
          const tableLines = lines.slice(tableStart, i);
          const raw = tableLines.join('\n');
          const start = lines.slice(0, tableStart).join('\n').length + (tableStart > 0 ? 1 : 0);
          const end = start + raw.length;
          results.push({ start, end, raw });
        }
        tableStart = -1;
        consecutivePipeLines = 0;
      }
    }

    // Handle table at end of content
    if (consecutivePipeLines >= 3 && tableStart !== -1) {
      const tableLines = lines.slice(tableStart);
      const raw = tableLines.join('\n');
      const start = lines.slice(0, tableStart).join('\n').length + (tableStart > 0 ? 1 : 0);
      const end = start + raw.length;
      results.push({ start, end, raw });
    }

    return results;
  }

  private _inferColumnTypes(
    table: ParsedTable,
  ): Record<string, 'numeric' | 'text' | 'mixed'> {
    const result: Record<string, 'numeric' | 'text' | 'mixed'> = {};

    for (let colIdx = 0; colIdx < table.headers.length; colIdx++) {
      const header = table.headers[colIdx];
      let numericCount = 0;
      let totalCount = 0;

      for (const row of table.rows) {
        const value = (row[colIdx] ?? '').trim();
        if (value.length === 0) continue;
        totalCount++;
        const num = parseFloat(value.replace(/,/g, ''));
        if (!isNaN(num)) numericCount++;
      }

      if (totalCount === 0) {
        result[header] = 'text';
      } else {
        const numericRatio = numericCount / totalCount;
        if (numericRatio >= 0.7) {
          result[header] = 'numeric';
        } else if (numericRatio >= 0.3) {
          result[header] = 'mixed';
        } else {
          result[header] = 'text';
        }
      }
    }

    return result;
  }

  generateTableSummary(tables: ParsedTable[], query: string): string {
    if (tables.length === 0) {
      return 'No tables found in the retrieved content.';
    }

    const queryTokens = query
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2);

    const lines: string[] = [
      `Found ${tables.length} table(s) in the retrieved content:`,
      '',
    ];

    for (const table of tables) {
      const headerList = table.headers.join(', ');
      const columnTypes = this._inferColumnTypes(table);
      const numericCols = table.headers.filter((h) => columnTypes[h] === 'numeric');

      // Check relevance: do any column names overlap with query tokens?
      const relevantColumns = table.headers.filter((h) =>
        queryTokens.some((t) => h.toLowerCase().includes(t)),
      );

      const relevanceNote =
        relevantColumns.length > 0
          ? ` Potentially relevant column(s): ${relevantColumns.join(', ')}.`
          : '';

      const captionNote = table.caption ? ` Caption: "${table.caption}".` : '';

      lines.push(
        `• Table ${table.id} (${table.rowCount} rows × ${table.colCount} cols): [${headerList}].` +
          (numericCols.length > 0 ? ` Numeric columns: ${numericCols.join(', ')}.` : '') +
          relevanceNote +
          captionNote,
      );
    }

    return lines.join('\n');
  }
}
