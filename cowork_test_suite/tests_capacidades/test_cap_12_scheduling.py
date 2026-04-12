"""
CAP-12: TAREAS PROGRAMADAS Y RECURRENTES
==========================================
Tests para capacidades de scheduling.

Sub-capacidades:
  12.1  Definir tareas con cadencia (diaria, semanal, etc.)
  12.2  Check de email cada manana, metricas semanales, digest de Slack
  12.3  Tareas on-demand guardadas
  12.4  Auto-ejecucion y recuerdo de configuracion

Total: ~250 tests
"""
from __future__ import annotations

from datetime import datetime
import pytest
from cowork_lib2 import cron_next
from cowork_lib3 import ScheduledTask, TaskScheduler, generate_digest


CRON_CASES = [
    # (expression, description, now, expected)
    ("0 9 * * *", "daily 9am", datetime(2026, 4, 11, 8, 30), datetime(2026, 4, 11, 9, 0)),
    ("*/15 * * * *", "every 15min", datetime(2026, 4, 11, 9, 32), datetime(2026, 4, 11, 9, 45)),
    ("0 0 1 * *", "monthly 1st", datetime(2026, 4, 11, 9, 0), datetime(2026, 5, 1, 0, 0)),
    ("0 12 * * 0", "sunday noon", datetime(2026, 4, 11, 8, 0), datetime(2026, 4, 12, 12, 0)),
    ("0 8 * * 1-5", "weekday 8am", datetime(2026, 4, 11, 7, 0), datetime(2026, 4, 13, 8, 0)),
    ("0 0 * * *", "midnight", datetime(2026, 4, 11, 23, 59), datetime(2026, 4, 12, 0, 0)),
    ("30 17 * * 5", "fri 5:30pm", datetime(2026, 4, 11, 8, 0), datetime(2026, 4, 17, 17, 30)),
]


# ============================================================================
# 12.1 — Definir tareas con cadencia
# ============================================================================

class TestTaskCadence:
    """12.1 — Define tasks with cadence (daily, weekly, etc.)."""

    @pytest.mark.parametrize("expr,desc,now,expected", CRON_CASES)
    def test_cron_next_fire(self, expr, desc, now, expected):
        result = cron_next(expr, now)
        assert result == expected, f"Failed for {desc}: expected {expected}, got {result}"

    @pytest.mark.parametrize("i", range(10))
    def test_daily_task_cadence(self, i):
        now = datetime(2026, 4, 10 + i, 10, 0)
        nxt = cron_next("0 9 * * *", now)
        assert nxt.hour == 9
        assert nxt.minute == 0
        assert nxt.day == 11 + i  # next day at 9am

    @pytest.mark.parametrize("hour", range(0, 24, 3))
    def test_hourly_schedule(self, hour):
        now = datetime(2026, 4, 12, hour, 30)
        nxt = cron_next("0 * * * *", now)
        assert nxt.minute == 0
        assert nxt.hour == (hour + 1) % 24

    @pytest.mark.parametrize("i", range(10))
    def test_weekly_schedule(self, i):
        now = datetime(2026, 4, 6 + i, 8, 0)  # starting Monday Apr 6
        nxt = cron_next("0 10 * * 1", now)  # Every Monday 10am (1=Monday in most cron)
        assert nxt.hour == 10


# ============================================================================
# 12.2 — Ejemplos: email check, metricas, digest
# ============================================================================

class TestScheduledExamples:
    """12.2 — Email check, weekly metrics, Slack digest examples."""

    @pytest.mark.parametrize("i", range(10))
    def test_email_check_task(self, i):
        scheduler = TaskScheduler()
        task = scheduler.add("email_check", "0 9 * * *", "check_inbox")
        assert task.name == "email_check"
        assert task.cron_expr == "0 9 * * *"
        assert task.action == "check_inbox"

    @pytest.mark.parametrize("i", range(10))
    def test_weekly_metrics_task(self, i):
        scheduler = TaskScheduler()
        task = scheduler.add("weekly_metrics", "0 8 * * 1", "generate_metrics_report")
        result = task.execute(datetime(2026, 4, 13, 8, 0))
        assert result["task"] == "weekly_metrics"
        assert result["run"] == 1

    @pytest.mark.parametrize("i", range(10))
    def test_slack_digest_task(self, i):
        scheduler = TaskScheduler()
        task = scheduler.add(f"slack_digest_{i}", "0 17 * * 1-5", "summarize_slack")
        result = task.execute(datetime(2026, 4, 13, 17, 0))
        assert result["action"] == "summarize_slack"

    @pytest.mark.parametrize("i", range(10))
    def test_digest_generation(self, i):
        items = [
            {"title": f"Update {j}", "summary": f"Summary of update {j} for period {i}"}
            for j in range(5)
        ]
        digest = generate_digest(f"Slack Channel #{i}", items)
        assert f"Slack Channel #{i}" in digest
        assert "Total items: 5" in digest
        assert "Update 0" in digest


# ============================================================================
# 12.3 — Tareas on-demand
# ============================================================================

class TestOnDemandTasks:
    """12.3 — On-demand saved tasks that can be triggered manually."""

    @pytest.mark.parametrize("i", range(15))
    def test_on_demand_task(self, i):
        scheduler = TaskScheduler()
        task = scheduler.add(f"report_{i}", "0 0 31 2 *", f"generate_report_{i}")  # never auto-fires
        result = task.execute(datetime(2026, 4, 12))
        assert result["task"] == f"report_{i}"
        assert task.run_count == 1

    @pytest.mark.parametrize("i", range(10))
    def test_task_list(self, i):
        scheduler = TaskScheduler()
        for j in range(5):
            scheduler.add(f"task_{j}", "0 9 * * *", f"action_{j}")
        tasks = scheduler.list_tasks()
        assert len(tasks) == 5
        assert all(t["enabled"] for t in tasks)

    @pytest.mark.parametrize("i", range(10))
    def test_task_toggle(self, i):
        scheduler = TaskScheduler()
        scheduler.add(f"toggle_task_{i}", "0 9 * * *", "action")
        enabled = scheduler.toggle(f"toggle_task_{i}")
        assert enabled is False  # was True, now False
        enabled2 = scheduler.toggle(f"toggle_task_{i}")
        assert enabled2 is True  # back to True

    @pytest.mark.parametrize("i", range(10))
    def test_toggle_nonexistent(self, i):
        scheduler = TaskScheduler()
        with pytest.raises(KeyError):
            scheduler.toggle(f"nonexistent_{i}")


# ============================================================================
# 12.4 — Auto-ejecucion
# ============================================================================

class TestAutoExecution:
    """12.4 — Auto-execution and configuration recall."""

    @pytest.mark.parametrize("i", range(15))
    def test_auto_execution(self, i):
        scheduler = TaskScheduler()
        scheduler.add("morning_check", "0 9 * * *", "check")
        scheduler.add("evening_report", "0 17 * * *", "report")
        results = scheduler.run_due(datetime(2026, 4, 12, 9, 0))
        assert len(results) == 2
        assert all(r["run"] == 1 for r in results)

    @pytest.mark.parametrize("i", range(10))
    def test_run_count_tracking(self, i):
        task = ScheduledTask(name="counter", cron_expr="0 * * * *", action="count")
        for j in range(i + 1):
            task.execute(datetime(2026, 4, 12, j))
        assert task.run_count == i + 1

    @pytest.mark.parametrize("i", range(10))
    def test_last_run_updated(self, i):
        task = ScheduledTask(name="tracker", cron_expr="0 9 * * *", action="track")
        now = datetime(2026, 4, 12 + i, 9, 0)
        task.execute(now)
        assert task.last_run == now

    @pytest.mark.parametrize("i", range(10))
    def test_disabled_task_skipped(self, i):
        scheduler = TaskScheduler()
        t1 = scheduler.add("active", "0 9 * * *", "run")
        t2 = scheduler.add("disabled", "0 9 * * *", "skip")
        scheduler.toggle("disabled")  # disable it
        results = scheduler.run_due(datetime(2026, 4, 12))
        # Only active task runs
        assert len(results) == 1
        assert results[0]["task"] == "active"
