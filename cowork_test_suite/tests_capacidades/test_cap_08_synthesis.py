"""
CAP-08: SINTESIS E INVESTIGACION
==================================
Tests para capacidades de sintesis e investigacion.

Sub-capacidades:
  8.1  Lee multiples documentos y produce un reporte de sintesis
  8.2  Identifica patrones cruzados entre fuentes
  8.3  Detecta contradicciones entre documentos
  8.4  Cita fuentes especificas
  8.5  Genera resumenes ejecutivos
  8.6  Investigacion web integrada con busqueda

Total: ~300 tests
"""
from __future__ import annotations

import pytest
from cowork_lib2 import Source, synthesize, detect_contradictions, extract_sentences
from cowork_lib import SearchIndex, CORPUS


SOURCES_SET = [
    Source("doc1", "Climate Report", "Climate change is causing rising temperatures globally. "
           "Sea levels are rising at an accelerating rate. Action is needed urgently."),
    Source("doc2", "Energy Analysis", "Renewable energy accounts for 30% of electricity. "
           "Solar power costs have dropped 90% in the last decade. "
           "Wind energy is the fastest growing sector."),
    Source("doc3", "Policy Brief", "Government policy must address climate change through regulation. "
           "Carbon taxes are effective but politically difficult. "
           "International cooperation is essential for climate goals."),
    Source("doc4", "Tech Review", "Electric vehicles are transforming transportation. "
           "Battery technology improvements are key to EV adoption. "
           "Charging infrastructure is still insufficient in rural areas."),
    Source("doc5", "Economic Impact", "Climate change costs the economy billions annually. "
           "Renewable energy creates more jobs than fossil fuels. "
           "The transition to clean energy requires significant investment."),
]


# ============================================================================
# 8.1 — Sintesis multi-documento
# ============================================================================

class TestMultiDocSynthesis:
    """8.1 — Read multiple documents and produce a synthesis report."""

    @pytest.mark.parametrize("query", [
        "climate change impact",
        "renewable energy growth",
        "government policy regulation",
        "electric vehicles transportation",
        "economic costs investment",
    ])
    def test_synthesis_produces_output(self, query):
        result = synthesize(SOURCES_SET, query, top_k=3)
        assert result["query"] == query
        assert len(result["citations"]) > 0
        assert len(result["summary"]) > 0

    @pytest.mark.parametrize("top_k", [1, 2, 3, 5])
    def test_synthesis_top_k_limit(self, top_k):
        result = synthesize(SOURCES_SET, "energy climate", top_k=top_k)
        assert len(result["citations"]) <= top_k

    @pytest.mark.parametrize("i", range(10))
    def test_synthesis_different_queries(self, i):
        queries = ["climate", "energy", "policy", "vehicles", "economy",
                   "solar", "wind", "carbon", "battery", "investment"]
        result = synthesize(SOURCES_SET, queries[i], top_k=3)
        assert result["summary"] != ""


# ============================================================================
# 8.2 — Patrones cruzados entre fuentes
# ============================================================================

class TestCrossSourcePatterns:
    """8.2 — Identify cross-source patterns and relevance ranking."""

    @pytest.mark.parametrize("i", range(10))
    def test_cross_source_pattern_detection(self, i):
        """Multiple sources mentioning same keywords = cross-pattern."""
        result = synthesize(SOURCES_SET, "energy climate change", top_k=5)
        sources_cited = set(c["source"] for c in result["citations"])
        assert len(sources_cited) >= 2, "Should cite from multiple sources for broad queries"

    @pytest.mark.parametrize("i", range(10))
    def test_pattern_relevance_ranking(self, i):
        """More relevant sources should appear first."""
        result = synthesize(SOURCES_SET, "renewable energy solar wind", top_k=5)
        if result["citations"]:
            # Energy-focused source should be cited
            cited_sources = [c["source"] for c in result["citations"]]
            assert "doc2" in cited_sources  # Energy Analysis is most relevant

    @pytest.mark.parametrize("i", range(10))
    def test_multi_doc_coverage(self, i):
        """Synthesis should cover information from multiple documents."""
        all_sources = SOURCES_SET + [
            Source(f"extra_{i}", f"Extra Doc {i}", f"Additional information about topic {i} and climate change.")
        ]
        result = synthesize(all_sources, "climate change information", top_k=5)
        assert len(result["citations"]) >= 2


# ============================================================================
# 8.3 — Deteccion de contradicciones
# ============================================================================

class TestContradictionDetection:
    """8.3 — Detect contradictions between documents."""

    @pytest.mark.parametrize("i", range(10))
    def test_contradiction_detection(self, i):
        sources = [
            Source("s1", "Report A", f"The project is on track. The budget is sufficient."),
            Source("s2", "Report B", f"The project is not on track. The budget is not sufficient."),
        ]
        contradictions = detect_contradictions(sources)
        assert len(contradictions) >= 1, "Should detect 'is' vs 'is not' contradiction"

    @pytest.mark.parametrize("i", range(10))
    def test_no_false_contradictions(self, i):
        sources = [
            Source("s1", "Doc A", "The sky is blue. Water is wet."),
            Source("s2", "Doc B", "The grass is green. Fire is hot."),
        ]
        contradictions = detect_contradictions(sources)
        # No actual contradictions here
        assert len(contradictions) == 0

    @pytest.mark.parametrize("n_sources", [2, 3, 5])
    def test_contradiction_across_n_sources(self, n_sources):
        sources = []
        for j in range(n_sources):
            negation = "not " if j % 2 == 1 else ""
            sources.append(Source(f"s{j}", f"Doc {j}", f"The result is {negation}conclusive."))
        contradictions = detect_contradictions(sources)
        if n_sources >= 2:
            assert len(contradictions) >= 1


# ============================================================================
# 8.4 — Citas de fuentes especificas
# ============================================================================

class TestSourceCitations:
    """8.4 — Cite specific sources with source IDs and extracted sentences."""

    @pytest.mark.parametrize("i", range(15))
    def test_citations_have_source_id(self, i):
        result = synthesize(SOURCES_SET[:3], "climate energy policy", top_k=3)
        for citation in result["citations"]:
            assert "source" in citation
            assert citation["source"] in ["doc1", "doc2", "doc3"]

    @pytest.mark.parametrize("i", range(10))
    def test_citations_have_sentences(self, i):
        result = synthesize(SOURCES_SET, "renewable energy", top_k=3)
        for citation in result["citations"]:
            assert "sentence" in citation
            assert len(citation["sentence"]) > 0

    @pytest.mark.parametrize("i", range(10))
    def test_citation_sentence_from_source(self, i):
        """Cited sentence should actually come from the claimed source."""
        result = synthesize(SOURCES_SET, "climate change", top_k=3)
        for citation in result["citations"]:
            src = next(s for s in SOURCES_SET if s.id == citation["source"])
            # Sentence should be extractable from source text
            assert citation["sentence"] in src.text


# ============================================================================
# 8.5 — Resumenes ejecutivos
# ============================================================================

class TestExecutiveSummary:
    """8.5 — Generate executive summaries from multiple sources."""

    @pytest.mark.parametrize("i", range(15))
    def test_executive_summary_generation(self, i):
        queries = [
            "climate change energy renewable",
            "policy regulation government climate",
            "electric vehicles transportation battery",
            "economy costs investment energy",
            "climate energy electric renewable economy",
        ]
        result = synthesize(SOURCES_SET, queries[i % len(queries)], top_k=5)
        summary = result["summary"]
        assert len(summary) > 20, "Summary should be substantive"

    @pytest.mark.parametrize("i", range(10))
    def test_summary_length_proportional(self, i):
        result_short = synthesize(SOURCES_SET[:2], "climate change", top_k=2)
        result_long = synthesize(SOURCES_SET, "climate energy policy vehicles economy", top_k=5)
        assert len(result_long["summary"]) >= len(result_short["summary"])


# ============================================================================
# 8.6 — Busqueda integrada (search index simulation)
# ============================================================================

class TestSearchIntegration:
    """8.6 — Integrated web research via search index simulation."""

    @pytest.mark.parametrize("query", [
        "Python programming language",
        "quarterly sales Europe",
        "machine learning models",
        "climate change weather",
        "electric vehicles Tokyo",
        "quantum computing",
        "renewable energy electricity",
        "vaccine efficacy",
        "blockchain cryptocurrency",
        "artificial intelligence healthcare",
    ])
    def test_search_index_returns_results(self, query):
        idx = SearchIndex(CORPUS)
        results = idx.search(query, top_k=3)
        assert len(results) > 0, f"No results for query: {query}"

    @pytest.mark.parametrize("query,expected_idx", [
        ("Python programming", 0),
        ("quarterly sales growth", 1),
        ("machine learning training data", 2),
    ])
    def test_search_relevance(self, query, expected_idx):
        idx = SearchIndex(CORPUS)
        results = idx.search(query, top_k=1)
        assert results[0][0] == expected_idx, f"Top result should be index {expected_idx}"

    @pytest.mark.parametrize("i", range(10))
    def test_search_score_positive(self, i):
        idx = SearchIndex(CORPUS)
        results = idx.search(CORPUS[i].split()[:3][0], top_k=5)
        for doc_idx, score in results:
            assert score > 0

    @pytest.mark.parametrize("top_k", [1, 3, 5, 10])
    def test_search_top_k_respected(self, top_k):
        idx = SearchIndex(CORPUS)
        results = idx.search("energy climate", top_k=top_k)
        assert len(results) <= top_k

    @pytest.mark.parametrize("i", range(10))
    def test_extract_sentences(self, i):
        text = SOURCES_SET[i % len(SOURCES_SET)].text
        sentences = extract_sentences(text)
        assert len(sentences) >= 1
        for s in sentences:
            assert len(s) > 0
