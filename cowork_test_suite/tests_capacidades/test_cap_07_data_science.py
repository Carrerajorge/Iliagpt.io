"""
CAP-07: ANALISIS DE DATOS Y DATA SCIENCE
==========================================
Tests para todas las sub-capacidades de analisis.

Sub-capacidades:
  7.1  Analisis estadistico (deteccion de outliers, cross-tabulation, series temporales)
  7.2  Machine learning: entrenar modelos predictivos
  7.3  Limpieza y transformacion de datasets
  7.4  Visualizacion de datos (charts, graficos)
  7.5  Analisis de varianza
  7.6  Forecasting y modelos financieros
  7.7  Extraccion de tablas de PDFs a Excel

Total: ~400 tests
"""
from __future__ import annotations

import math
import statistics
import pytest
from pathlib import Path

from cowork_lib2 import (
    zscore_outliers,
    moving_average_forecast,
    linear_regression,
    knn_classify,
    cross_tab,
    write_png_chart,
)
from cowork_lib3 import (
    clean_dataset,
    variance_analysis,
    detect_trend,
    seasonal_decompose,
    extract_pdf_tables,
    create_excel_with_formulas,
)
from cowork_lib import generate_document, DocSpec


@pytest.fixture
def out_dir(tmp_path):
    d = tmp_path / "cap07_ds"
    d.mkdir()
    return d


# ============================================================================
# 7.1 — Analisis estadistico
# ============================================================================

@pytest.mark.data_science
class TestOutlierDetection:
    """7.1a — Z-score outlier detection across data distributions."""

    @pytest.mark.parametrize("i", range(20))
    def test_zscore_outlier_detection(self, i):
        values = [10.0] * 50 + [10.0 + i * 100]  # last value is outlier
        outliers = zscore_outliers(values, threshold=2.0)
        if i > 0:
            assert 50 in outliers, "Extreme value should be detected as outlier"

    @pytest.mark.parametrize("i", range(15))
    def test_zscore_no_false_positives(self, i):
        values = [10.0 + j * 0.1 for j in range(50)]  # all close
        outliers = zscore_outliers(values, threshold=3.0)
        assert len(outliers) == 0, "Normal distribution should have no outliers at 3 sigma"

    @pytest.mark.parametrize("threshold", [1.5, 2.0, 2.5, 3.0, 3.5])
    def test_zscore_threshold_sensitivity(self, threshold):
        values = list(range(100)) + [500]
        outliers = zscore_outliers(values, threshold=threshold)
        assert len(outliers) >= 1  # 500 is always an outlier


@pytest.mark.data_science
class TestCrossTabulation:
    """7.1b — Cross-tabulation of categorical data."""

    @pytest.mark.parametrize("i", range(15))
    def test_cross_tab(self, i):
        rows = [
            ("Male", "Urban"), ("Female", "Rural"), ("Male", "Rural"),
            ("Female", "Urban"), ("Male", "Urban"), ("Female", "Urban"),
        ] * (i + 1)
        ct = cross_tab(rows)
        assert "Male" in ct
        assert "Female" in ct
        assert "Urban" in ct["Male"]

    @pytest.mark.parametrize("n_categories", [2, 3, 5, 8])
    def test_cross_tab_dimensions(self, n_categories):
        rows = [(f"R{i % n_categories}", f"C{i % 3}") for i in range(100)]
        ct = cross_tab(rows)
        assert len(ct) == n_categories


@pytest.mark.data_science
class TestTimeSeries:
    """7.1c — Time series trend detection and seasonal decomposition."""

    @pytest.mark.parametrize("i", range(10))
    def test_trend_detection_up(self, i):
        series = [j + i * 0.5 for j in range(20)]
        assert detect_trend(series) == "up"

    @pytest.mark.parametrize("i", range(10))
    def test_trend_detection_down(self, i):
        series = [100 - j - i * 0.5 for j in range(20)]
        assert detect_trend(series) == "down"

    @pytest.mark.parametrize("i", range(10))
    def test_trend_detection_flat(self, i):
        series = [50.0 + (j % 2) * 0.001 for j in range(20)]
        assert detect_trend(series) == "flat"

    @pytest.mark.parametrize("period", [4, 6, 12])
    def test_seasonal_decomposition(self, period):
        series = [math.sin(2 * math.pi * j / period) * 10 + 100 for j in range(48)]
        result = seasonal_decompose(series, period=period)
        assert "trend" in result
        assert "seasonal" in result
        assert len(result["trend"]) == len(series)


# ============================================================================
# 7.2 — Machine Learning
# ============================================================================

@pytest.mark.data_science
class TestKNNClassification:
    """7.2a — K-nearest-neighbors classification."""

    @pytest.mark.parametrize("i", range(20))
    def test_knn_classification(self, i):
        labeled = [
            ([0, 0], "A"), ([1, 0], "A"), ([0, 1], "A"),
            ([10, 10], "B"), ([11, 10], "B"), ([10, 11], "B"),
        ]
        result = knn_classify([0.5 + i * 0.01, 0.5], labeled, k=3)
        assert result == "A"

    @pytest.mark.parametrize("i", range(15))
    def test_knn_boundary(self, i):
        labeled = [([j, 0], "left") for j in range(5)] + [([j + 10, 0], "right") for j in range(5)]
        result = knn_classify([5 + i * 0.01, 0], labeled, k=3)
        # Near boundary, should be one or the other
        assert result in ("left", "right")

    @pytest.mark.parametrize("k", [1, 3, 5, 7])
    def test_knn_k_values(self, k):
        labeled = [([j, 0], "A" if j < 5 else "B") for j in range(10)]
        result = knn_classify([4.5, 0], labeled, k=k)
        assert result in ("A", "B")


@pytest.mark.data_science
class TestLinearRegression:
    """7.2b — Linear regression fitting and R-squared evaluation."""

    @pytest.mark.parametrize("i", range(10))
    def test_linear_regression_perfect_fit(self, i):
        xs = list(range(10))
        ys = [2 * x + 3 + i for x in xs]
        slope, intercept, r2 = linear_regression(xs, ys)
        assert abs(slope - 2.0) < 0.01
        assert abs(r2 - 1.0) < 0.01

    @pytest.mark.parametrize("i", range(10))
    def test_linear_regression_r_squared(self, i):
        xs = list(range(20))
        ys = [x * 1.5 + 10 + (j % 3) * 0.1 for j, x in enumerate(xs)]
        slope, intercept, r2 = linear_regression(xs, ys)
        assert r2 > 0.95, "Well-fitted data should have high R-squared"


# ============================================================================
# 7.3 — Limpieza y transformacion
# ============================================================================

@pytest.mark.data_science
class TestDataCleaning:
    """7.3 — Dataset cleaning: null removal, dirty-percentage handling, and deduplication."""

    @pytest.mark.parametrize("i", range(15))
    def test_clean_null_removal(self, i):
        data = [
            {"a": f"val_{i}", "b": "ok"},
            {"a": None, "b": "drop"},
            {"a": "", "b": "drop"},
            {"a": f"val2_{i}", "b": "ok"},
        ]
        cleaned = clean_dataset(data, drop_nulls=True)
        assert len(cleaned) == 2

    @pytest.mark.parametrize("pct_dirty", [10, 25, 50, 75])
    def test_clean_dirty_percentage(self, pct_dirty):
        n = 100
        data = []
        for j in range(n):
            if j < n * pct_dirty / 100:
                data.append({"id": str(j), "val": None})
            else:
                data.append({"id": str(j), "val": f"good_{j}"})
        cleaned = clean_dataset(data, drop_nulls=True)
        expected_clean = n - int(n * pct_dirty / 100)
        assert len(cleaned) == expected_clean

    @pytest.mark.parametrize("i", range(10))
    def test_clean_dedup_by_key(self, i):
        data = [{"id": j % 5, "val": j} for j in range(20)]
        cleaned = clean_dataset(data, dedup_key="id", drop_nulls=False)
        assert len(cleaned) == 5


# ============================================================================
# 7.4 — Visualizacion de datos
# ============================================================================

@pytest.mark.data_science
class TestChartGeneration:
    """7.4 — Data visualization: PNG chart generation and validation."""

    @pytest.mark.parametrize("chart_type", ["line", "scatter", "bar_sim"])
    @pytest.mark.parametrize("n_points", [10, 50, 100])
    def test_chart_generation(self, out_dir, chart_type, n_points):
        xs = list(range(n_points))
        ys = [x ** 1.5 for x in xs]
        path = out_dir / f"{chart_type}_{n_points}.png"
        write_png_chart(path, xs, ys, title=f"{chart_type} chart")
        assert path.exists() and path.stat().st_size > 500

    @pytest.mark.parametrize("i", range(10))
    def test_chart_png_valid(self, out_dir, i):
        path = out_dir / f"valid_{i}.png"
        write_png_chart(path, range(10), [x * i for x in range(10)])
        assert path.read_bytes()[:4] == b"\x89PNG"


# ============================================================================
# 7.5 — Analisis de varianza
# ============================================================================

@pytest.mark.data_science
class TestVarianceAnalysis:
    """7.5 — Budget variance analysis: favorable/unfavorable detection and percentage calculation."""

    @pytest.mark.parametrize("i", range(15))
    def test_variance_analysis_favorable(self, i):
        budget = {"Marketing": 10000 + i * 100, "Engineering": 20000}
        actual = {"Marketing": 9000 + i * 50, "Engineering": 18000}
        result = variance_analysis(budget, actual)
        assert result["Marketing"]["favorable"] is True  # spent less than budget
        assert result["Engineering"]["favorable"] is True

    @pytest.mark.parametrize("i", range(15))
    def test_variance_analysis_unfavorable(self, i):
        budget = {"Sales": 5000}
        actual = {"Sales": 7000 + i * 100}
        result = variance_analysis(budget, actual)
        assert result["Sales"]["favorable"] is False  # overspent

    @pytest.mark.parametrize("n_items", [3, 5, 8, 12])
    def test_variance_analysis_completeness(self, n_items):
        budget = {f"Dept_{j}": 1000 * (j + 1) for j in range(n_items)}
        actual = {f"Dept_{j}": 950 * (j + 1) for j in range(n_items)}
        result = variance_analysis(budget, actual)
        assert len(result) == n_items
        for key in result:
            assert "variance" in result[key]
            assert "variance_pct" in result[key]

    @pytest.mark.parametrize("i", range(10))
    def test_variance_percentage_calculation(self, i):
        budget = {"item": 1000.0}
        actual = {"item": 1000.0 + i * 100}
        result = variance_analysis(budget, actual)
        expected_pct = (i * 100 / 1000.0) * 100
        assert abs(result["item"]["variance_pct"] - expected_pct) < 0.1


# ============================================================================
# 7.6 — Forecasting
# ============================================================================

@pytest.mark.data_science
class TestForecasting:
    """7.6 — Moving-average forecasting: window sizes, horizons, and trend continuation."""

    @pytest.mark.parametrize("window", [2, 3, 5, 7])
    def test_moving_average_forecast(self, window):
        series = [10.0, 20.0, 30.0, 40.0, 50.0, 60.0, 70.0, 80.0]
        forecast = moving_average_forecast(series, window=window, horizon=3)
        assert len(forecast) == 3
        for f in forecast:
            assert f > 0

    @pytest.mark.parametrize("horizon", [1, 3, 5, 10])
    def test_forecast_horizon_length(self, horizon):
        series = [j * 10.0 for j in range(20)]
        forecast = moving_average_forecast(series, window=3, horizon=horizon)
        assert len(forecast) == horizon

    @pytest.mark.parametrize("i", range(10))
    def test_forecast_stable_series(self, i):
        series = [100.0] * 20
        forecast = moving_average_forecast(series, window=5, horizon=5)
        for f in forecast:
            assert abs(f - 100.0) < 0.01

    @pytest.mark.parametrize("i", range(10))
    def test_forecast_trending_series(self, i):
        series = [j * 5.0 + i for j in range(20)]
        forecast = moving_average_forecast(series, window=3, horizon=3)
        # Forecast should continue roughly in the same direction
        assert forecast[0] > series[0]


# ============================================================================
# 7.7 — Extraccion de tablas de PDFs a Excel
# ============================================================================

@pytest.mark.data_science
class TestPdfTableExtraction:
    """7.7 — Extract tabular data from PDFs and write to Excel."""

    @pytest.mark.parametrize("i", range(15))
    def test_pdf_table_extraction(self, out_dir, i):
        lines = [
            f"Product  Quantity  Price",
            f"Widget_{i}  {10 + i}  ${(10 + i) * 5}",
            f"Gadget_{i}  {20 + i}  ${(20 + i) * 3}",
        ]
        spec = DocSpec(kind="pdf", title=f"Invoice_{i}", sections=lines)
        pdf_path = generate_document(spec, out_dir)
        rows = extract_pdf_tables(pdf_path)
        assert len(rows) >= 2

    @pytest.mark.parametrize("i", range(10))
    def test_pdf_to_excel_pipeline(self, out_dir, i):
        """Full pipeline: extract from PDF, write to Excel."""
        lines = [f"Item{j}  {j * 100}  {j * 10}" for j in range(5)]
        spec = DocSpec(kind="pdf", title=f"Data_{i}", sections=lines)
        pdf_path = generate_document(spec, out_dir)
        rows = extract_pdf_tables(pdf_path)
        # Write extracted data to Excel
        excel_rows = [["Extracted Data"]] + rows
        excel_path = out_dir / f"extracted_{i}.xlsx"
        create_excel_with_formulas(excel_path, excel_rows, {})
        assert excel_path.exists()
