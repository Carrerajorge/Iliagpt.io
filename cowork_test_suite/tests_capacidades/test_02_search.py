"""
Pilar 2 — Búsqueda de información.

Construye un índice sobre un corpus determinista y lanza consultas. Verifica
que el documento más relevante aparece en el top-k y que los scores decaen
monótonamente.

25 docs × 40 variantes de query = 1000 tests.
"""
import pytest
from cowork_lib import SearchIndex, CORPUS, tokenize


INDEX = SearchIndex(CORPUS)
DOC_INDICES = list(range(len(CORPUS)))
VARIANTS = list(range(40))


def _query_for(doc_idx: int, variant: int) -> str:
    toks = [t for t in tokenize(CORPUS[doc_idx]) if len(t) > 3]
    if not toks:
        return CORPUS[doc_idx]
    # rotate through tokens; deterministic
    step = variant % max(len(toks), 1)
    picked = [toks[(step + k) % len(toks)] for k in range(min(3, len(toks)))]
    return " ".join(picked)


@pytest.mark.parametrize("doc_idx", DOC_INDICES)
@pytest.mark.parametrize("variant", VARIANTS)
def test_search_retrieves_correct_doc(doc_idx: int, variant: int):
    query = _query_for(doc_idx, variant)
    results = INDEX.search(query, top_k=5)
    assert results, f"no results for query={query!r}"
    top_ids = [r[0] for r in results]
    assert doc_idx in top_ids, (
        f"expected doc {doc_idx} in top-5 for query {query!r}, got {top_ids}"
    )
    # monotonic non-increasing scores
    scores = [r[1] for r in results]
    assert all(scores[i] >= scores[i + 1] for i in range(len(scores) - 1))
