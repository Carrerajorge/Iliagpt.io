/**
 * SearchBrainPanel — the user-facing surface for the SearchBrain
 * academic + web + deep pipeline.
 *
 * Layout: a three-panel view.
 *   - Top row:       mode tabs (academic / web / deep), query input, run button.
 *   - Left column:   source multi-chip selector (academic sources +
 *                    web sources + opt-in scraping toggle).
 *   - Main column:   result cards (title, authors, year, journal,
 *                    citation count, OA badge, PDF link, APA copy).
 *   - Right column:  deep-mode synthesis panel with clickable [N]
 *                    markers that scroll the corresponding card into
 *                    view + briefly highlight it.
 *
 * The component is intentionally self-contained: state lives in local
 * React state (no Zustand store), fetch is via `useSearchBrain`, and
 * styling uses the project's existing shadcn UI primitives.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { formatApa } from "./apa";
import { useSearchBrain, type SearchMode } from "./useSearchBrain";
import type {
  AcademicResponse,
  AcademicResultCard,
  AcademicSource,
  DeepResponse,
  WebSource,
} from "./types";

export function SearchBrainPanel() {
  const { catalog, catalogLoading, academic, web, deep, runAcademic, runWeb, runDeep } = useSearchBrain();
  const [mode, setMode] = useState<SearchMode>("academic");
  const [query, setQuery] = useState("");
  const [selectedAcademic, setSelectedAcademic] = useState<AcademicSource[]>([]);
  const [selectedWeb, setSelectedWeb] = useState<WebSource[]>([]);
  const [enableScraping, setEnableScraping] = useState(false);
  const [copiedNumber, setCopiedNumber] = useState<number | null>(null);
  const [highlightedRef, setHighlightedRef] = useState<number | null>(null);

  useEffect(() => {
    if (!catalog) return;
    if (selectedAcademic.length === 0) setSelectedAcademic(catalog.defaults);
    if (selectedWeb.length === 0) setSelectedWeb(catalog.webDefaults);
  }, [catalog, selectedAcademic.length, selectedWeb.length]);

  const handleRun = useCallback(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) return;
    if (mode === "academic") {
      void runAcademic({
        query: trimmed,
        sources: selectedAcademic,
        enableScrapingProviders: enableScraping,
        rerank: true,
      });
    } else if (mode === "web") {
      void runWeb({
        query: trimmed,
        sources: selectedWeb,
        maxResults: 15,
      });
    } else {
      void runDeep({
        query: trimmed,
        academicSources: selectedAcademic,
        webSources: selectedWeb,
        maxAcademic: 8,
        maxWeb: 4,
        enableScrapingProviders: enableScraping,
      });
    }
  }, [mode, query, selectedAcademic, selectedWeb, enableScraping, runAcademic, runWeb, runDeep]);

  const loading =
    (mode === "academic" && academic.loading) ||
    (mode === "web" && web.loading) ||
    (mode === "deep" && deep.loading);

  const error =
    (mode === "academic" && academic.error) ||
    (mode === "web" && web.error) ||
    (mode === "deep" && deep.error);

  const activeAcademic: AcademicResponse | null =
    mode === "deep" ? deep.data?.academic ?? null : mode === "web" ? web.data : academic.data;

  const deepData: DeepResponse | null = mode === "deep" ? deep.data : null;

  const toggleAcademic = (src: AcademicSource) => {
    setSelectedAcademic((prev) => (prev.includes(src) ? prev.filter((s) => s !== src) : [...prev, src]));
  };

  const toggleWeb = (src: WebSource) => {
    setSelectedWeb((prev) => (prev.includes(src) ? prev.filter((s) => s !== src) : [...prev, src]));
  };

  return (
    <div className="flex h-full flex-col gap-3 p-4" data-testid="search-brain-panel">
      {/* Top row: mode + query + run */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-md border border-border" data-testid="search-brain-mode-tabs">
          {(["academic", "web", "deep"] as SearchMode[]).map((m) => (
            <button
              key={m}
              type="button"
              data-testid={`search-brain-mode-${m}`}
              onClick={() => setMode(m)}
              className={`px-3 py-1.5 text-sm transition-colors ${
                mode === m ? "bg-primary text-primary-foreground" : "bg-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {m === "academic" ? "Académico" : m === "web" ? "Web" : "Profundo"}
            </button>
          ))}
        </div>
        <Input
          placeholder="Consulta de investigación…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleRun();
            }
          }}
          className="min-w-64 flex-1"
          data-testid="search-brain-query-input"
        />
        <Button onClick={handleRun} disabled={loading} data-testid="search-brain-run">
          {loading ? "Buscando…" : "Buscar"}
        </Button>
      </div>

      {/* Source chips + scraping opt-in */}
      <div className="flex flex-wrap gap-2" data-testid="search-brain-source-chips">
        {(mode === "web" ? [] : catalog?.providers ?? []).map((p) => {
          const src = p.id as AcademicSource;
          const active = selectedAcademic.includes(src);
          const scrapingDisabled = (p.id === "scopus" || p.id === "wos") && !enableScraping;
          return (
            <button
              key={p.id}
              type="button"
              disabled={scrapingDisabled}
              onClick={() => toggleAcademic(src)}
              data-testid={`search-brain-chip-${p.id}`}
              className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                active ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground"
              } ${scrapingDisabled ? "opacity-40" : ""}`}
              title={p.rateLimitNote ?? p.name}
            >
              {p.name}
              {scrapingDisabled && " 🔒"}
            </button>
          );
        })}
        {mode !== "academic" && catalog?.webProviders?.map((p) => {
          const src = p.id as WebSource;
          const active = selectedWeb.includes(src);
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => toggleWeb(src)}
              data-testid={`search-brain-web-chip-${p.id}`}
              className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                active ? "border-secondary bg-secondary/10 text-foreground" : "border-border text-muted-foreground"
              }`}
              title={p.rateLimitNote ?? p.name}
            >
              {p.name}
            </button>
          );
        })}
        <label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground" data-testid="search-brain-scraping-toggle">
          <Checkbox
            checked={enableScraping}
            onCheckedChange={(v) => setEnableScraping(v === true)}
            id="search-brain-scraping"
          />
          Usar scraping académico bajo mi IP (Scopus / WoS)
        </label>
      </div>

      {catalogLoading && <div className="text-xs text-muted-foreground">Cargando proveedores…</div>}
      {error && <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-sm text-destructive" data-testid="search-brain-error">{error}</div>}

      {/* Main + synthesis */}
      <div className="grid flex-1 grid-cols-1 gap-3 md:grid-cols-3" data-testid="search-brain-grid">
        <div className="col-span-2 flex min-h-0 flex-col gap-2 overflow-y-auto pr-1" data-testid="search-brain-results">
          {activeAcademic?.results?.length ? activeAcademic.results.map((r, i) => (
            <ResultCard
              key={`${r.source}-${i}-${r.doi ?? r.url}`}
              result={r}
              index={i + 1}
              highlighted={highlightedRef !== null && deepData?.synthesis.references.some((ref) => ref.number === highlightedRef && ref.url === r.url)}
              copiedNumber={copiedNumber}
              onCopied={(n) => {
                setCopiedNumber(n);
                window.setTimeout(() => setCopiedNumber((cur) => (cur === n ? null : cur)), 1500);
              }}
            />
          )) : (!loading && <div className="text-sm text-muted-foreground" data-testid="search-brain-empty">Sin resultados todavía. Lanza una búsqueda.</div>)}
          {mode !== "academic" && (web.data?.results?.length || deep.data?.web?.results?.length) ? (
            <div className="mt-2 text-xs uppercase tracking-wider text-muted-foreground">Web</div>
          ) : null}
          {(deep.data?.web?.results ?? web.data?.results ?? []).map((r, i) => (
            <a
              key={`web-${i}-${r.url}`}
              href={r.url}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md border border-border px-3 py-2 text-sm hover:border-foreground/40"
              data-testid="search-brain-web-card"
            >
              <div className="font-medium">{r.title}</div>
              {r.snippet && <div className="text-xs text-muted-foreground">{r.snippet}</div>}
              <div className="text-[10px] text-muted-foreground">{r.host ?? r.source}</div>
            </a>
          ))}
        </div>

        <aside className="flex min-h-0 flex-col gap-2 overflow-y-auto" data-testid="search-brain-synthesis">
          <SynthesisPanel
            deep={deepData}
            onCitationClick={(n) => {
              setHighlightedRef(n);
              window.setTimeout(() => setHighlightedRef(null), 2000);
            }}
          />
          <ProviderTraces response={activeAcademic} />
        </aside>
      </div>
    </div>
  );
}

interface ResultCardProps {
  result: AcademicResultCard;
  index: number;
  highlighted: boolean;
  copiedNumber: number | null;
  onCopied: (index: number) => void;
}

function ResultCard({ result, index, highlighted, copiedNumber, onCopied }: ResultCardProps) {
  const cardRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (highlighted) cardRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [highlighted]);

  const copyApa = async () => {
    const apa = formatApa({
      title: result.title,
      authors: result.authors,
      year: result.year,
      journal: result.journal,
      doi: result.doi,
      url: result.url,
    });
    try {
      await navigator.clipboard.writeText(apa);
      onCopied(index);
    } catch {
      // Clipboard can be denied; silently ignore.
    }
  };

  return (
    <Card
      ref={cardRef}
      className={`border ${highlighted ? "border-primary ring-2 ring-primary/40" : "border-border"}`}
      data-testid="search-brain-card"
    >
      <CardContent className="space-y-1.5 p-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <a
            href={result.url}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium hover:underline"
            data-testid="search-brain-card-title"
          >
            {index}. {result.title}
          </a>
          <div className="flex flex-wrap items-center gap-1">
            {result.openAccess && (
              <Badge variant="secondary" data-testid="search-brain-oa-badge">Acceso abierto</Badge>
            )}
            {typeof result.citationCount === "number" && (
              <Badge variant="outline" data-testid="search-brain-citations-badge">{result.citationCount} citas</Badge>
            )}
            <Badge variant="outline" data-testid="search-brain-source-badge">{result.source}</Badge>
          </div>
        </div>
        <div className="text-xs text-muted-foreground">
          {result.authors.join(", ")}
          {result.year ? ` · ${result.year}` : ""}
          {result.journal ? ` · ${result.journal}` : ""}
        </div>
        {result.abstract && (
          <p className="line-clamp-3 text-sm text-muted-foreground">{result.abstract}</p>
        )}
        <div className="flex flex-wrap gap-2 pt-1">
          {result.pdfUrl && (
            <a
              href={result.pdfUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-primary underline-offset-4 hover:underline"
              data-testid="search-brain-pdf-link"
            >
              PDF
            </a>
          )}
          <button
            type="button"
            onClick={copyApa}
            className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            data-testid="search-brain-copy-apa"
          >
            {copiedNumber === index ? "Copiado ✓" : "Copiar cita APA 7"}
          </button>
        </div>
      </CardContent>
    </Card>
  );
}

function SynthesisPanel({ deep, onCitationClick }: { deep: DeepResponse | null; onCitationClick: (n: number) => void }) {
  const parts = useMemo(() => splitAnswerByCitations(deep?.synthesis.answer ?? ""), [deep?.synthesis.answer]);
  if (!deep) {
    return (
      <div className="rounded-md border border-border bg-muted/20 p-3 text-sm text-muted-foreground" data-testid="search-brain-synthesis-empty">
        Cambia a modo <strong>Profundo</strong> para generar una respuesta sintetizada con citas APA 7.
      </div>
    );
  }
  return (
    <div className="rounded-md border border-border bg-card p-3" data-testid="search-brain-synthesis-body">
      <div className="text-sm leading-relaxed text-foreground">
        {parts.map((p, i) => {
          if (p.type === "text") return <span key={i}>{p.value}</span>;
          return (
            <button
              key={i}
              type="button"
              onClick={() => onCitationClick(p.number)}
              className="mx-0.5 rounded bg-primary/10 px-1 text-xs font-semibold text-primary hover:bg-primary/20"
              data-testid={`search-brain-inline-cite-${p.number}`}
            >
              [{p.number}]
            </button>
          );
        })}
      </div>
      {deep.synthesis.references.length > 0 && (
        <ol className="mt-3 space-y-1 text-xs text-muted-foreground" data-testid="search-brain-references">
          {deep.synthesis.references.map((ref) => (
            <li key={ref.number} id={`search-brain-ref-${ref.number}`} className="pl-2">
              <span className="font-semibold text-foreground">[{ref.number}]</span> {ref.apa}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function ProviderTraces({ response }: { response: AcademicResponse | null }) {
  if (!response) return null;
  return (
    <div className="rounded-md border border-border bg-card p-3 text-xs" data-testid="search-brain-provider-traces">
      <div className="mb-1 font-semibold">Proveedores</div>
      <ul className="space-y-0.5">
        {response.providers.map((p) => (
          <li key={p.source} className="flex items-center justify-between gap-2">
            <span className={p.ok ? "text-foreground" : "text-muted-foreground"}>{p.source}</span>
            <span className="text-muted-foreground">
              {p.count} hits · {p.durationMs}ms{p.error ? ` · ${p.error}` : ""}
            </span>
          </li>
        ))}
      </ul>
      {response.cache?.hit && (
        <div className="mt-2 text-xs text-emerald-600" data-testid="search-brain-cache-indicator">
          Resultado desde caché ({response.cache.matchedBy ?? "exacto"})
        </div>
      )}
    </div>
  );
}

export type AnswerPart = { type: "text"; value: string } | { type: "cite"; number: number };

export function splitAnswerByCitations(answer: string): AnswerPart[] {
  if (!answer) return [];
  const out: AnswerPart[] = [];
  const regex = /\[(\d{1,3})\]/g;
  let lastIndex = 0;
  let match;
  while ((match = regex.exec(answer)) !== null) {
    if (match.index > lastIndex) {
      out.push({ type: "text", value: answer.slice(lastIndex, match.index) });
    }
    out.push({ type: "cite", number: Number(match[1]) });
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < answer.length) out.push({ type: "text", value: answer.slice(lastIndex) });
  return out;
}
