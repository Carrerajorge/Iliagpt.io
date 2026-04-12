"""
CAP-13: DISPATCH (DESDE EL CELULAR)
=====================================
Tests para capacidades de dispatch movil.

Sub-capacidades:
  13.1  Enviar tareas desde iOS/Android
  13.2  Ejecucion en escritorio
  13.3  Hilo de conversacion persistente
  13.4  Disponibilidad Pro y Max

Total: ~200 tests
"""
from __future__ import annotations

import uuid
import pytest
from cowork_lib2 import Dispatch
from cowork_lib3 import check_plan_access


DEVICES = ["iphone", "android", "ipad"]


# ============================================================================
# 13.1 — Enviar tareas desde movil
# ============================================================================

class TestMobileTaskSending:
    """13.1 — Send tasks from iOS/Android devices."""

    @pytest.mark.parametrize("device", DEVICES * 10)
    def test_dispatch_send(self, device):
        d = Dispatch()
        msg_id = d.send(device, "generate quarterly report")
        assert msg_id is not None
        assert len(msg_id) > 0
        assert any(m["id"] == msg_id for m in d.queue)

    @pytest.mark.parametrize("i", range(20))
    def test_dispatch_unique_ids(self, i):
        d = Dispatch()
        ids = [d.send("iphone", f"task_{j}") for j in range(10)]
        assert len(set(ids)) == 10  # all unique

    @pytest.mark.parametrize("device", DEVICES)
    def test_dispatch_task_content(self, device):
        d = Dispatch()
        task = f"analyze sales data for {device}"
        msg_id = d.send(device, task)
        msg = next(m for m in d.queue if m["id"] == msg_id)
        assert msg["task"] == task
        assert msg["device"] == device

    @pytest.mark.parametrize("i", range(10))
    def test_dispatch_queue_order(self, i):
        d = Dispatch()
        ids = [d.send("iphone", f"task_{j}") for j in range(5)]
        for j, msg in enumerate(d.queue):
            assert msg["id"] == ids[j]
            assert msg["task"] == f"task_{j}"

    @pytest.mark.parametrize("n_tasks", [1, 5, 10, 25])
    def test_dispatch_batch_send(self, n_tasks):
        d = Dispatch()
        for j in range(n_tasks):
            d.send("android", f"batch_task_{j}")
        assert len(d.queue) == n_tasks


# ============================================================================
# 13.2 — Ejecucion en escritorio
# ============================================================================

class TestDesktopExecution:
    """13.2 — Execute dispatched tasks on the desktop."""

    @pytest.mark.parametrize("device", DEVICES * 5)
    def test_dispatch_execute(self, device):
        d = Dispatch()
        d.send(device, "make a report")
        result = d.execute_next()
        assert result is not None
        assert result["status"] == "done"

    @pytest.mark.parametrize("i", range(15))
    def test_dispatch_execute_fifo(self, i):
        d = Dispatch()
        d.send("iphone", f"first_{i}")
        d.send("android", f"second_{i}")
        r1 = d.execute_next()
        assert r1["task"] == f"first_{i}"
        r2 = d.execute_next()
        assert r2["task"] == f"second_{i}"

    @pytest.mark.parametrize("i", range(10))
    def test_dispatch_execute_empty_queue(self, i):
        d = Dispatch()
        result = d.execute_next()
        assert result is None

    @pytest.mark.parametrize("i", range(10))
    def test_dispatch_status_transition(self, i):
        d = Dispatch()
        msg_id = d.send("iphone", f"task_{i}")
        msg = next(m for m in d.queue if m["id"] == msg_id)
        assert msg["status"] == "queued"
        d.execute_next()
        assert msg["status"] == "done"

    @pytest.mark.parametrize("n_tasks", [3, 5, 10])
    def test_dispatch_execute_all(self, n_tasks):
        d = Dispatch()
        for j in range(n_tasks):
            d.send("ipad", f"task_{j}")
        executed = 0
        while True:
            result = d.execute_next()
            if result is None:
                break
            executed += 1
        assert executed == n_tasks


# ============================================================================
# 13.3 — Hilo persistente
# ============================================================================

class TestPersistentThread:
    """13.3 — Persistent conversation thread across dispatches."""

    @pytest.mark.parametrize("i", range(15))
    def test_dispatch_persistent_queue(self, i):
        d = Dispatch()
        d.send("iphone", f"msg1_{i}")
        d.send("iphone", f"msg2_{i}")
        d.send("iphone", f"msg3_{i}")
        assert len(d.queue) == 3
        # Queue maintains all messages even after execution
        d.execute_next()
        assert len(d.queue) == 3  # messages stay in queue
        assert d.queue[0]["status"] == "done"
        assert d.queue[1]["status"] == "queued"

    @pytest.mark.parametrize("i", range(10))
    def test_dispatch_cross_device_thread(self, i):
        d = Dispatch()
        d.send("iphone", f"from_phone_{i}")
        d.send("android", f"from_tablet_{i}")
        # Both should be in same queue (single thread)
        assert len(d.queue) == 2
        assert d.queue[0]["device"] == "iphone"
        assert d.queue[1]["device"] == "android"


# ============================================================================
# 13.4 — Disponibilidad Pro y Max
# ============================================================================

class TestPlanAvailability:
    """13.4 — Dispatch availability for Pro and Max plans."""

    @pytest.mark.parametrize("plan", ["pro", "max"])
    def test_dispatch_available_for_plan(self, plan):
        assert check_plan_access(plan, "dispatch") is True

    @pytest.mark.parametrize("plan", ["free", "basic", "starter"])
    def test_dispatch_unavailable_for_plan(self, plan):
        assert check_plan_access(plan, "dispatch") is False

    @pytest.mark.parametrize("plan", ["team", "enterprise"])
    def test_dispatch_team_enterprise(self, plan):
        # Team and enterprise should have access to general features
        assert check_plan_access(plan, "general") is True

    @pytest.mark.parametrize("plan,feature", [
        ("pro", "dispatch"),
        ("max", "dispatch"),
        ("enterprise", "rbac"),
        ("enterprise", "private_marketplace"),
    ])
    def test_plan_feature_matrix(self, plan, feature):
        assert check_plan_access(plan, feature) is True

    @pytest.mark.parametrize("plan,feature", [
        ("pro", "rbac"),
        ("pro", "private_marketplace"),
        ("team", "rbac"),
    ])
    def test_plan_feature_restrictions(self, plan, feature):
        assert check_plan_access(plan, feature) is False
