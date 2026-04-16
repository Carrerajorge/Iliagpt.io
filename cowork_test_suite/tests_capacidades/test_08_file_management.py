"""
Capability 2 — File management: rename, dedupe, organize, safe delete.
~500 tests.
"""
from __future__ import annotations

import pathlib
from datetime import datetime

import pytest

from cowork_lib2 import (
    dedupe_files, rename_with_date_prefix, organize_by_extension,
    safe_delete, path_within,
)


def make_files(root: pathlib.Path, spec: dict[str, bytes]) -> None:
    for name, content in spec.items():
        (root / name).write_bytes(content)


# ---- dedupe ----
@pytest.mark.parametrize("n_uniques,n_dupes", [(i, j) for i in range(1, 11) for j in range(0, 6)])
def test_dedupe(tmp_path, n_uniques, n_dupes):
    for i in range(n_uniques):
        (tmp_path / f"u_{i}.txt").write_bytes(f"unique-{i}".encode())
    for i in range(n_dupes):
        (tmp_path / f"d_{i}.txt").write_bytes(b"unique-0")
    u, d = dedupe_files(tmp_path)
    assert u == n_uniques
    assert d == n_dupes


# ---- rename with date prefix ----
@pytest.mark.parametrize("n", list(range(1, 21)))
def test_rename_prefix(tmp_path, n):
    for i in range(n):
        (tmp_path / f"file_{i}.txt").write_text("x")
    when = datetime(2026, 4, 11)
    count = rename_with_date_prefix(tmp_path, when)
    assert count == n
    assert all(p.name.startswith("2026-04-11_") for p in tmp_path.iterdir() if p.is_file())


# ---- organize by extension ----
@pytest.mark.parametrize("seed", list(range(50)))
def test_organize(tmp_path, seed):
    exts = ["txt", "md", "csv", "pdf", "json"]
    for i, ext in enumerate(exts):
        (tmp_path / f"f_{seed}_{i}.{ext}").write_text("x")
    counts = organize_by_extension(tmp_path)
    assert set(counts.keys()) == set(exts)
    for ext in exts:
        assert (tmp_path / ext).is_dir()


# ---- safe delete guard ----
@pytest.mark.parametrize("i", range(50))
def test_safe_delete_denied(tmp_path, i):
    f = tmp_path / f"keep_{i}.txt"
    f.write_text("important")
    assert safe_delete(f, allow=False) is False
    assert f.exists()


@pytest.mark.parametrize("i", range(50))
def test_safe_delete_allowed(tmp_path, i):
    f = tmp_path / f"go_{i}.txt"
    f.write_text("bye")
    assert safe_delete(f, allow=True) is True
    assert not f.exists()


# ---- path sandboxing ----
@pytest.mark.parametrize("i", range(100))
def test_path_within(tmp_path, i):
    root = tmp_path / "root"
    root.mkdir()
    good = root / f"a_{i}.txt"
    good.write_text("x")
    assert path_within(root, good) is True


@pytest.mark.parametrize("i", range(100))
def test_path_outside(tmp_path, i):
    root = tmp_path / "root"
    root.mkdir()
    # create a sibling outside root
    outside = tmp_path / f"b_{i}.txt"
    outside.write_text("x")
    assert path_within(root, outside) is False
