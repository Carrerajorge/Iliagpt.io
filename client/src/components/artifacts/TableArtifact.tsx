import { useState, useMemo, useCallback } from "react";
import { ArrowUpDown, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface TableArtifactProps {
  content: string;
}

function parseMarkdownTable(content: string): {
  headers: string[];
  rows: string[][];
} {
  const lines = content
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("|") && l.endsWith("|"));

  if (lines.length < 2) return { headers: [], rows: [] };

  const parseLine = (line: string): string[] =>
    line
      .slice(1, -1)
      .split("|")
      .map((cell) => cell.trim());

  const headers = parseLine(lines[0]);

  // Skip separator row (contains dashes)
  const dataStart = lines[1].replace(/[|\s-:]/g, "").length === 0 ? 2 : 1;
  const rows = lines.slice(dataStart).map(parseLine);

  return { headers, rows };
}

export function TableArtifact({ content }: TableArtifactProps) {
  const [sortCol, setSortCol] = useState<number | null>(null);
  const [sortAsc, setSortAsc] = useState(true);
  const [filter, setFilter] = useState("");

  const { headers, rows } = useMemo(
    () => parseMarkdownTable(content),
    [content]
  );

  const handleSort = useCallback(
    (colIndex: number) => {
      if (sortCol === colIndex) {
        setSortAsc((prev) => !prev);
      } else {
        setSortCol(colIndex);
        setSortAsc(true);
      }
    },
    [sortCol]
  );

  const filteredAndSorted = useMemo(() => {
    let result = rows;

    if (filter) {
      const lowerFilter = filter.toLowerCase();
      result = result.filter((row) =>
        row.some((cell) => cell.toLowerCase().includes(lowerFilter))
      );
    }

    if (sortCol !== null) {
      result = [...result].sort((a, b) => {
        const aVal = a[sortCol] ?? "";
        const bVal = b[sortCol] ?? "";
        const aNum = Number(aVal);
        const bNum = Number(bVal);

        if (!isNaN(aNum) && !isNaN(bNum)) {
          return sortAsc ? aNum - bNum : bNum - aNum;
        }
        const cmp = aVal.localeCompare(bVal);
        return sortAsc ? cmp : -cmp;
      });
    }

    return result;
  }, [rows, filter, sortCol, sortAsc]);

  if (headers.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
        Could not parse table data.
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Filter bar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-muted/50">
        <Search className="h-3.5 w-3.5 text-muted-foreground" />
        <Input
          placeholder="Filter rows..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="h-7 text-xs flex-1"
        />
        <span className="text-xs text-muted-foreground shrink-0">
          {filteredAndSorted.length} / {rows.length} rows
        </span>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-muted">
            <tr>
              {headers.map((header, i) => (
                <th
                  key={i}
                  className={cn(
                    "px-3 py-2 text-left font-medium text-foreground cursor-pointer",
                    "hover:bg-accent/50 transition-colors select-none border-b border-border"
                  )}
                  onClick={() => handleSort(i)}
                >
                  <div className="flex items-center gap-1">
                    <span>{header}</span>
                    <ArrowUpDown
                      className={cn(
                        "h-3 w-3 text-muted-foreground",
                        sortCol === i && "text-foreground"
                      )}
                    />
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredAndSorted.map((row, rowIdx) => (
              <tr
                key={rowIdx}
                className="border-b border-border/50 hover:bg-accent/30 transition-colors"
              >
                {row.map((cell, cellIdx) => (
                  <td
                    key={cellIdx}
                    className="px-3 py-2 text-foreground"
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
