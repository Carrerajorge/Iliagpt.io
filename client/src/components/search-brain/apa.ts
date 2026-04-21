/**
 * Client-side APA 7 formatter for SearchBrain result cards.
 *
 * Mirrors the server-side formatter in
 * server/services/searchBrain/deepSynthesis.ts so the "Copy APA" button
 * on each card produces the same string the /deep endpoint would
 * emit for that same paper's reference. We DON'T import the server
 * file — the client bundle shouldn't pull server code, and the logic
 * is trivial enough that a small duplicate is cheaper than a barrel
 * export plumbed through shared/.
 */

export interface ApaInput {
  title: string;
  authors?: string[];
  year?: number;
  journal?: string;
  doi?: string;
  url?: string;
}

function formatAuthors(authors: string[] | undefined): string {
  if (!authors || authors.length === 0) return "";
  const clean = (s: string) => s.trim();
  if (authors.length === 1) return clean(authors[0]!);
  if (authors.length === 2) return `${clean(authors[0]!)}, & ${clean(authors[1]!)}`;
  const first = authors.slice(0, 20).map(clean);
  if (authors.length > 20) {
    return `${first.slice(0, 19).join(", ")}, … ${clean(authors[authors.length - 1]!)}`;
  }
  return `${first.slice(0, -1).join(", ")}, & ${first.at(-1)!}`;
}

export function formatApa(input: ApaInput): string {
  const parts: string[] = [];
  const authors = formatAuthors(input.authors);
  if (authors) parts.push(`${authors}.`);
  parts.push(input.year ? `(${input.year}).` : "(n.d.).");
  if (input.title) parts.push(`${input.title}.`);
  if (input.journal) parts.push(`*${input.journal}*.`);
  if (input.doi) parts.push(`https://doi.org/${input.doi}`);
  else if (input.url) parts.push(input.url);
  return parts.join(" ");
}
