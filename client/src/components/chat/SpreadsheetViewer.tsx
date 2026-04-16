/**
 * SpreadsheetViewer — Excel-like viewer for generated spreadsheets.
 * Renders data in a grid with column letters (A,B,C...), row numbers,
 * colored headers, sheet tabs, formula bar, and download button.
 * Matches Claude's artifact spreadsheet rendering.
 */

import React, { useState, useMemo, memo } from "react";
import { cn } from "@/lib/utils";
import { Download, RefreshCw, X } from "lucide-react";

export interface SheetData {
  name: string;
  headers: string[];
  rows: string[][];
}

interface SpreadsheetViewerProps {
  sheets: SheetData[];
  filename: string;
  downloadUrl?: string;
  onClose?: () => void;
}

function colLetter(i: number): string {
  let s = "";
  let n = i;
  while (n >= 0) {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  }
  return s;
}

export const SpreadsheetViewer = memo(function SpreadsheetViewer({
  sheets,
  filename,
  downloadUrl,
  onClose,
}: SpreadsheetViewerProps) {
  const [activeSheet, setActiveSheet] = useState(0);
  const [selectedCell, setSelectedCell] = useState<string | null>(null);

  const sheet = sheets[activeSheet] || sheets[0];
  if (!sheet) return null;

  const maxCols = Math.max(sheet.headers.length, ...sheet.rows.map(r => r.length));

  return (
    <div className="flex flex-col h-full bg-white dark:bg-zinc-900 text-sm">
      {/* Title bar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-6 h-6 rounded bg-emerald-600 flex items-center justify-center text-white text-[10px] font-bold shrink-0">
            XL
          </div>
          <span className="text-[13px] font-medium text-zinc-700 dark:text-zinc-200 truncate">{filename}</span>
          <span className="text-[11px] text-zinc-400 px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 shrink-0">XLSX</span>
        </div>
        <div className="flex items-center gap-1">
          {downloadUrl && (
            <a href={downloadUrl} download={filename} className="p-1.5 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors" title="Descargar">
              <Download className="h-4 w-4 text-zinc-500" />
            </a>
          )}
          {onClose && (
            <button onClick={onClose} className="p-1.5 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors" title="Cerrar">
              <X className="h-4 w-4 text-zinc-500" />
            </button>
          )}
        </div>
      </div>

      {/* Formula bar */}
      <div className="flex items-center px-2 py-1 border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50/50 dark:bg-zinc-800/30">
        <span className="text-[11px] text-zinc-400 italic font-mono px-2">
          {selectedCell ? `${selectedCell}` : "fx"}
        </span>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-auto">
        <table className="w-full border-collapse" style={{ minWidth: maxCols * 140 }}>
          {/* Column headers (A, B, C...) */}
          <thead className="sticky top-0 z-10">
            <tr>
              <th className="w-10 min-w-[40px] bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-[10px] text-zinc-400 font-normal text-center sticky left-0 z-20" />
              {Array.from({ length: maxCols }, (_, i) => (
                <th key={i} className="min-w-[120px] bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-[10px] text-zinc-500 font-medium text-center py-1">
                  {colLetter(i)}
                </th>
              ))}
            </tr>
            {/* Data headers (row 1) */}
            {sheet.headers.length > 0 && (
              <tr>
                <td className="bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-[10px] text-zinc-400 text-center font-normal py-1 sticky left-0 z-20">
                  1
                </td>
                {sheet.headers.map((h, i) => (
                  <td
                    key={i}
                    onClick={() => setSelectedCell(`${colLetter(i)}1`)}
                    className={cn(
                      "px-2 py-1.5 border border-zinc-200 dark:border-zinc-600 text-[12px] font-semibold cursor-pointer",
                      "bg-blue-700 text-white",
                      selectedCell === `${colLetter(i)}1` && "ring-2 ring-blue-400 ring-inset",
                    )}
                  >
                    {h}
                  </td>
                ))}
                {/* Fill empty header cells */}
                {Array.from({ length: maxCols - sheet.headers.length }, (_, i) => (
                  <td key={`eh${i}`} className="px-2 py-1.5 border border-zinc-200 dark:border-zinc-600 bg-blue-700" />
                ))}
              </tr>
            )}
          </thead>
          <tbody>
            {sheet.rows.map((row, ri) => (
              <tr key={ri} className={ri % 2 === 0 ? "bg-white dark:bg-zinc-900" : "bg-zinc-50/50 dark:bg-zinc-800/20"}>
                <td className="bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-[10px] text-zinc-400 text-center font-normal py-1 sticky left-0 z-10">
                  {ri + 2}
                </td>
                {row.map((cell, ci) => (
                  <td
                    key={ci}
                    onClick={() => setSelectedCell(`${colLetter(ci)}${ri + 2}`)}
                    className={cn(
                      "px-2 py-1.5 border border-zinc-100 dark:border-zinc-800 text-[12px] text-zinc-700 dark:text-zinc-300 cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-900/10 transition-colors",
                      selectedCell === `${colLetter(ci)}${ri + 2}` && "ring-2 ring-blue-400 ring-inset bg-blue-50 dark:bg-blue-900/20",
                    )}
                  >
                    {cell}
                  </td>
                ))}
                {/* Fill empty cells */}
                {Array.from({ length: maxCols - row.length }, (_, i) => (
                  <td key={`e${i}`} className="px-2 py-1.5 border border-zinc-100 dark:border-zinc-800" />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Sheet tabs */}
      {sheets.length > 1 && (
        <div className="flex items-center border-t border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 px-2 py-1 gap-1 overflow-x-auto">
          {sheets.map((s, i) => (
            <button
              key={i}
              onClick={() => { setActiveSheet(i); setSelectedCell(null); }}
              className={cn(
                "px-3 py-1 text-[11px] rounded-md transition-colors whitespace-nowrap",
                i === activeSheet
                  ? "bg-white dark:bg-zinc-700 text-zinc-800 dark:text-zinc-200 font-medium shadow-sm border border-zinc-200 dark:border-zinc-600"
                  : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700/50",
              )}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
});

export default SpreadsheetViewer;
