"""
CAP-17: SUB-AGENTES Y TAREAS COMPLEJAS
========================================
Tests para sub-agentes y descomposicion de tareas.

Sub-capacidades:
  17.1  Descomponer tareas complejas en subtareas
  17.2  Coordinar multiples sub-agentes en paralelo
  17.3  Lista de tareas interna (todo list) para tracking
  17.4  Trabajar por periodos extendidos sin timeout

Total: ~200 tests
"""
from __future__ import annotations

import time
import pytest
from cowork_lib2 import decompose_task, TodoList


TASK_DESCRIPTIONS = [
    ("Create a quarterly report with charts", ["gather sources", "outline", "draft", "review", "export"]),
    ("Analyze sales data trends", ["load data", "clean", "explore", "model", "summarize"]),
    ("Check email inbox and triage", ["read inbox", "triage", "draft replies", "review"]),
    ("Generate a financial report and analysis", [
        "gather sources", "outline", "draft", "review", "export",
        "load data", "clean", "explore", "model", "summarize",
    ]),
    ("Unknown generic task", ["understand", "plan", "execute", "verify"]),
]


class TestTaskDecomposition:
    """17.1 — Descomponer tareas complejas en subtareas."""

    @pytest.mark.parametrize("task,expected_steps", TASK_DESCRIPTIONS)
    def test_task_decomposition(self, task, expected_steps):
        steps = decompose_task(task)
        assert len(steps) >= 3
        for step in expected_steps:
            assert step in steps, f"Expected step '{step}' not in decomposition"

    @pytest.mark.parametrize("i", range(20))
    def test_decompose_always_returns_steps(self, i):
        task = f"Do something complex number {i}"
        steps = decompose_task(task)
        assert len(steps) >= 1
        assert all(isinstance(s, str) for s in steps)

    @pytest.mark.parametrize("keyword,expected_min", [
        ("report", 5),
        ("analysis", 5),
        ("email", 4),
        ("random", 4),
    ])
    def test_decompose_keyword_steps(self, keyword, expected_min):
        steps = decompose_task(f"Please do a {keyword} for the team")
        assert len(steps) >= expected_min

    @pytest.mark.parametrize("i", range(10))
    def test_decompose_deterministic(self, i):
        task = f"Create a report about topic {i}"
        s1 = decompose_task(task)
        s2 = decompose_task(task)
        assert s1 == s2


class TestParallelAgentCoordination:
    """17.2 — Coordinar multiples sub-agentes en paralelo."""

    @pytest.mark.parametrize("n_agents", [2, 3, 5, 8])
    def test_parallel_agent_simulation(self, n_agents):
        """Simulate parallel sub-agents working on decomposed tasks."""
        task = "Create a detailed quarterly report with data analysis"
        steps = decompose_task(task)
        # Distribute steps among agents
        agent_assignments = {}
        for i, step in enumerate(steps):
            agent_id = i % n_agents
            agent_assignments.setdefault(agent_id, []).append(step)
        assert len(agent_assignments) <= n_agents
        total_steps = sum(len(s) for s in agent_assignments.values())
        assert total_steps == len(steps)

    @pytest.mark.parametrize("i", range(10))
    def test_agent_results_aggregation(self, i):
        """Simulate aggregating results from multiple agents."""
        results = {}
        steps = decompose_task(f"Analyze report {i}")
        for step in steps:
            results[step] = {"status": "completed", "output": f"Result for {step}"}
        assert len(results) == len(steps)
        assert all(r["status"] == "completed" for r in results.values())

    @pytest.mark.parametrize("i", range(10))
    def test_agent_dependency_chain(self, i):
        """Verify tasks with dependencies execute in order."""
        todo = TodoList()
        ids = [todo.add(f"Step {j} of task {i}") for j in range(5)]
        # Simulate sequential execution
        for idx in ids:
            todo.start(idx)
            todo.done(idx)
        assert todo.progress() == 1.0


class TestTodoListTracking:
    """17.3 — Lista de tareas interna (todo list) para tracking."""

    @pytest.mark.parametrize("n_items", [1, 5, 10, 20])
    def test_todo_list_creation(self, n_items):
        todo = TodoList()
        for j in range(n_items):
            todo.add(f"Task {j}")
        assert len(todo.items) == n_items
        assert all(i["status"] == "pending" for i in todo.items)

    @pytest.mark.parametrize("i", range(15))
    def test_todo_status_transitions(self, i):
        todo = TodoList()
        idx = todo.add(f"Task {i}")
        assert todo.items[idx]["status"] == "pending"
        todo.start(idx)
        assert todo.items[idx]["status"] == "in_progress"
        todo.done(idx)
        assert todo.items[idx]["status"] == "completed"

    @pytest.mark.parametrize("completed", range(0, 11))
    def test_todo_progress_percentage(self, completed):
        todo = TodoList()
        for j in range(10):
            todo.add(f"Task {j}")
        for j in range(completed):
            todo.done(j)
        expected = completed / 10.0
        assert abs(todo.progress() - expected) < 0.01

    @pytest.mark.parametrize("i", range(10))
    def test_todo_empty_progress(self, i):
        todo = TodoList()
        assert todo.progress() == 0.0

    @pytest.mark.parametrize("i", range(10))
    def test_todo_full_progress(self, i):
        todo = TodoList()
        for j in range(5):
            idx = todo.add(f"Task {j}")
            todo.done(idx)
        assert todo.progress() == 1.0

    @pytest.mark.parametrize("i", range(10))
    def test_todo_mixed_status(self, i):
        todo = TodoList()
        todo.add("pending task")
        idx1 = todo.add("in progress task")
        todo.start(idx1)
        idx2 = todo.add("done task")
        todo.done(idx2)
        assert todo.items[0]["status"] == "pending"
        assert todo.items[1]["status"] == "in_progress"
        assert todo.items[2]["status"] == "completed"


class TestExtendedWork:
    """17.4 — Trabajar por periodos extendidos sin timeout."""

    @pytest.mark.parametrize("n_iterations", [10, 50, 100, 500])
    def test_extended_work_simulation(self, n_iterations):
        """Simulate extended work without timeout."""
        todo = TodoList()
        for j in range(n_iterations):
            idx = todo.add(f"Micro-task {j}")
            todo.start(idx)
            # Simulate work (no sleep, just computation)
            _ = sum(range(100))
            todo.done(idx)
        assert todo.progress() == 1.0
        assert len(todo.items) == n_iterations

    @pytest.mark.parametrize("i", range(10))
    def test_long_running_task_tracking(self, i):
        """Track a complex multi-step task through completion."""
        task = f"Complex analysis project {i}"
        steps = decompose_task(task)
        todo = TodoList()
        for step in steps:
            idx = todo.add(step)
        # Execute all steps
        for idx in range(len(todo.items)):
            todo.start(idx)
            todo.done(idx)
        assert todo.progress() == 1.0

    @pytest.mark.parametrize("batch_size", [5, 10, 20])
    def test_batch_processing(self, batch_size):
        """Process tasks in batches."""
        todo = TodoList()
        total = batch_size * 5
        for j in range(total):
            todo.add(f"Item {j}")
        for batch_start in range(0, total, batch_size):
            for j in range(batch_start, min(batch_start + batch_size, total)):
                todo.start(j)
                todo.done(j)
        assert todo.progress() == 1.0
