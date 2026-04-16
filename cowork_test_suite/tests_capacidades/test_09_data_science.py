"""
Capability 3 — Data science: stats, outliers, forecasting, regression, kNN, cross-tab.
~800 tests.
"""
from __future__ import annotations

import math
import random
import statistics

import pytest

from cowork_lib2 import (
    zscore_outliers, moving_average_forecast, linear_regression,
    knn_classify, cross_tab,
)


# ---- outlier detection ----
@pytest.mark.parametrize("seed", list(range(100)))
def test_outliers_detects(seed):
    rng = random.Random(seed)
    series = [rng.gauss(0, 1) for _ in range(50)]
    series[7] = 50.0  # extreme
    outs = zscore_outliers(series)
    assert 7 in outs


@pytest.mark.parametrize("seed", list(range(50)))
def test_outliers_none(seed):
    rng = random.Random(seed + 3000)
    series = [rng.uniform(-0.5, 0.5) for _ in range(200)]
    outs = zscore_outliers(series, threshold=5.0)
    assert outs == []


# ---- moving average forecast ----
@pytest.mark.parametrize("seed", list(range(100)))
def test_moving_avg_length(seed):
    rng = random.Random(seed)
    series = [rng.random() for _ in range(20)]
    f = moving_average_forecast(series, window=4, horizon=5)
    assert len(f) == 5


@pytest.mark.parametrize("seed", list(range(100)))
def test_moving_avg_stable_on_constant(seed):
    series = [5.0] * 15
    f = moving_average_forecast(series, window=3, horizon=3)
    assert all(abs(x - 5.0) < 1e-9 for x in f)


# ---- linear regression ----
@pytest.mark.parametrize("slope", [0.5, 1.0, 2.0, -1.5, 3.3])
@pytest.mark.parametrize("intercept", [0.0, 1.0, -2.5])
@pytest.mark.parametrize("n", [10, 25, 50])
def test_linear_regression_recovers(slope, intercept, n):
    xs = list(range(n))
    ys = [slope * x + intercept for x in xs]
    s, i, r2 = linear_regression(xs, ys)
    assert abs(s - slope) < 1e-6
    assert abs(i - intercept) < 1e-6
    assert r2 > 0.999


# ---- kNN ----
@pytest.mark.parametrize("k", [1, 3, 5])
@pytest.mark.parametrize("seed", list(range(50)))
def test_knn_classifies(k, seed):
    rng = random.Random(seed)
    # class A around (0,0), class B around (10,10)
    data = []
    for _ in range(20):
        data.append(((rng.gauss(0, 0.5), rng.gauss(0, 0.5)), "A"))
        data.append(((rng.gauss(10, 0.5), rng.gauss(10, 0.5)), "B"))
    # near A
    assert knn_classify((0.0, 0.0), data, k=k) == "A"
    # near B
    assert knn_classify((10.0, 10.0), data, k=k) == "B"


# ---- cross-tab ----
@pytest.mark.parametrize("seed", list(range(100)))
def test_cross_tab(seed):
    rng = random.Random(seed)
    rows = []
    for _ in range(100):
        r = rng.choice(["M", "F"])
        c = rng.choice(["y", "n"])
        rows.append((r, c))
    ct = cross_tab(rows)
    total = sum(v for inner in ct.values() for v in inner.values())
    assert total == 100
