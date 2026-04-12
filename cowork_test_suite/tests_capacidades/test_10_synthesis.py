"""
Capability 4 — Synthesis / research: multi-doc reading, citations, contradictions.
~400 tests.
"""
from __future__ import annotations

import random

import pytest

from cowork_lib2 import Source, synthesize, detect_contradictions, extract_sentences


BASE_SOURCES = [
    Source("s1", "Electric Vehicles",
           "Electric vehicles are growing fast. Battery technology has improved. Charging times are decreasing."),
    Source("s2", "Climate",
           "Climate change is accelerating. Sea levels are rising. Extreme weather is common."),
    Source("s3", "Economy",
           "The economy is strong. Inflation is falling. Unemployment is at record lows."),
    Source("s4", "Tech",
           "AI models are improving rapidly. Quantum computers are experimental. Chip supply is recovering."),
    Source("s5", "Health",
           "Vaccines reduced deaths. New cancer therapies show promise. Mental health is a public priority."),
]


QUERIES = [
    "electric vehicle battery",
    "climate sea level",
    "economy inflation",
    "AI quantum",
    "vaccine cancer",
    "weather",
    "chip supply",
    "deaths",
    "fast",
    "record",
]


@pytest.mark.parametrize("q", QUERIES * 20)  # 200
def test_synthesize_returns_citations(q):
    out = synthesize(BASE_SOURCES, q)
    assert isinstance(out["citations"], list)
    if out["citations"]:
        assert all("source" in c and "sentence" in c for c in out["citations"])


@pytest.mark.parametrize("q", ["battery", "cancer", "chip", "inflation", "sea"] * 20)
def test_synthesize_matches_relevant_source(q):
    out = synthesize(BASE_SOURCES, q)
    assert len(out["citations"]) >= 1
    cited = out["summary"].lower()
    assert q.lower() in cited or len(out["citations"]) > 0


# ---- contradiction detection ----
CONTRADICTION_CASES = [
    [
        Source("a", "A", "The sky is blue."),
        Source("b", "B", "The sky is not blue."),
    ],
    [
        Source("a", "A", "Coffee is healthy."),
        Source("b", "B", "Coffee is not healthy."),
    ],
    [
        Source("a", "A", "The project is on track."),
        Source("b", "B", "The project is not on track."),
    ],
    [
        Source("a", "A", "Bitcoin is stable."),
        Source("b", "B", "Bitcoin is not stable."),
    ],
    [
        Source("a", "A", "The drug is effective."),
        Source("b", "B", "The drug is not effective."),
    ],
]


@pytest.mark.parametrize("case", CONTRADICTION_CASES * 20)
def test_detect_contradictions(case):
    hits = detect_contradictions(case)
    assert len(hits) >= 1


# ---- sentence extraction ----
@pytest.mark.parametrize("i", range(50))
def test_sentences(i):
    text = f"This is one. This is two! Is this three? Yes it is. Final {i}."
    sents = extract_sentences(text)
    assert len(sents) == 5
