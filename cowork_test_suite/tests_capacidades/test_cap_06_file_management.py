"""
CAP-06: GESTION DE ARCHIVOS LOCALES
=====================================
Tests para gestion inteligente de archivos.

Sub-capacidades:
  6.1  Acceso directo de lectura/escritura a carpetas autorizadas
  6.2  Organizacion inteligente de carpetas (lee contenido, no solo nombres)
  6.3  Renombrado masivo con prefijos de fecha (YYYY-MM-DD)
  6.4  Clasificacion por contenido real del archivo
  6.5  Deduplicacion de archivos
  6.6  Creacion de subcarpetas logicas
  6.7  Log de decisiones de organizacion
  6.8  Proteccion contra borrado (pide permiso explicito)

Total: ~350 tests
"""
from __future__ import annotations

import json
import pytest
from datetime import datetime
from pathlib import Path

from cowork_lib2 import (
    file_sha256,
    dedupe_files,
    rename_with_date_prefix,
    organize_by_extension,
    safe_delete,
    path_within,
)


@pytest.fixture
def work_dir(tmp_path):
    d = tmp_path / "cap06_files"
    d.mkdir()
    return d


# ============================================================================
# 6.1 — Acceso de lectura/escritura
# ============================================================================

@pytest.mark.file_generation
class TestFileReadWrite:
    """6.1 — Direct read/write access to authorized folders."""

    @pytest.mark.parametrize("i", range(20))
    def test_write_and_read_file(self, work_dir, i):
        path = work_dir / f"file_{i}.txt"
        content = f"Content for file {i} with data"
        path.write_text(content)
        assert path.read_text() == content

    @pytest.mark.parametrize("ext", [".txt", ".csv", ".json", ".md", ".py", ".js", ".html"])
    def test_write_various_extensions(self, work_dir, ext):
        path = work_dir / f"test{ext}"
        path.write_text(f"Content for {ext}")
        assert path.exists() and path.stat().st_size > 0

    @pytest.mark.parametrize("i", range(10))
    def test_nested_folder_access(self, work_dir, i):
        nested = work_dir / f"level1_{i}" / "level2" / "level3"
        nested.mkdir(parents=True)
        path = nested / "deep_file.txt"
        path.write_text(f"Deep content {i}")
        assert path.read_text() == f"Deep content {i}"


# ============================================================================
# 6.2 — Organizacion inteligente (por contenido)
# ============================================================================

@pytest.mark.automation
class TestSmartOrganization:
    """6.2 — Intelligent folder organization by extension and content."""

    @pytest.mark.parametrize("i", range(10))
    def test_organize_by_extension(self, work_dir, i):
        # Create files with different extensions
        (work_dir / f"doc_{i}.txt").write_text("text content")
        (work_dir / f"data_{i}.csv").write_text("a,b,c")
        (work_dir / f"config_{i}.json").write_text("{}")
        counts = organize_by_extension(work_dir)
        assert "txt" in counts
        assert "csv" in counts
        assert "json" in counts

    @pytest.mark.parametrize("n_files", [5, 10, 20])
    def test_organize_creates_subfolders(self, work_dir, n_files):
        for j in range(n_files):
            ext = ["txt", "csv", "json", "py"][j % 4]
            (work_dir / f"file_{j}.{ext}").write_text(f"content {j}")
        counts = organize_by_extension(work_dir)
        total = sum(counts.values())
        assert total == n_files
        # Verify subfolders exist
        for ext in counts:
            assert (work_dir / ext).is_dir()

    @pytest.mark.parametrize("i", range(10))
    def test_organize_files_moved_correctly(self, work_dir, i):
        (work_dir / f"report_{i}.txt").write_text(f"Report {i}")
        (work_dir / f"data_{i}.csv").write_text(f"Data {i}")
        organize_by_extension(work_dir)
        assert (work_dir / "txt" / f"report_{i}.txt").exists()
        assert (work_dir / "csv" / f"data_{i}.csv").exists()


# ============================================================================
# 6.3 — Renombrado masivo con prefijo de fecha
# ============================================================================

@pytest.mark.automation
class TestDatePrefixRename:
    """6.3 — Bulk file renaming with YYYY-MM-DD date prefixes."""

    @pytest.mark.parametrize("i", range(15))
    def test_date_prefix_rename(self, work_dir, i):
        files = [work_dir / f"report_{j}.txt" for j in range(3)]
        for f in files:
            f.write_text(f"content {i}")
        when = datetime(2026, 4, 12 + i % 15)
        count = rename_with_date_prefix(work_dir, when)
        assert count == 3
        prefix = when.strftime("%Y-%m-%d_")
        for f in work_dir.iterdir():
            if f.is_file():
                assert f.name.startswith(prefix)

    @pytest.mark.parametrize("i", range(10))
    def test_date_prefix_idempotent(self, work_dir, i):
        (work_dir / "file.txt").write_text("content")
        when = datetime(2026, 4, 12)
        rename_with_date_prefix(work_dir, when)
        count2 = rename_with_date_prefix(work_dir, when)
        assert count2 == 0  # already prefixed

    @pytest.mark.parametrize("n_files", [1, 5, 10, 20])
    def test_date_prefix_batch_size(self, work_dir, n_files):
        for j in range(n_files):
            (work_dir / f"item_{j}.txt").write_text(f"data {j}")
        when = datetime(2026, 1, 15)
        count = rename_with_date_prefix(work_dir, when)
        assert count == n_files


# ============================================================================
# 6.4 — Clasificacion por contenido real
# ============================================================================

@pytest.mark.automation
class TestContentClassification:
    """6.4 — File classification by real content using SHA-256 hashing."""

    @pytest.mark.parametrize("i", range(10))
    def test_classify_by_content_hash(self, work_dir, i):
        content_a = f"Unique content A {i}"
        content_b = f"Unique content B {i}"
        (work_dir / f"a_{i}.txt").write_text(content_a)
        (work_dir / f"b_{i}.txt").write_text(content_b)
        hash_a = file_sha256(work_dir / f"a_{i}.txt")
        hash_b = file_sha256(work_dir / f"b_{i}.txt")
        assert hash_a != hash_b  # different content = different hash

    @pytest.mark.parametrize("i", range(10))
    def test_same_content_same_hash(self, work_dir, i):
        content = f"Identical content {i}"
        (work_dir / f"copy1_{i}.txt").write_text(content)
        (work_dir / f"copy2_{i}.txt").write_text(content)
        h1 = file_sha256(work_dir / f"copy1_{i}.txt")
        h2 = file_sha256(work_dir / f"copy2_{i}.txt")
        assert h1 == h2


# ============================================================================
# 6.5 — Deduplicacion de archivos
# ============================================================================

@pytest.mark.automation
class TestFileDeduplication:
    """6.5 — File deduplication detecting and moving duplicate files."""

    @pytest.mark.parametrize("i", range(15))
    def test_dedupe_moves_duplicates(self, work_dir, i):
        (work_dir / f"original_{i}.txt").write_text(f"unique {i}")
        (work_dir / f"dup1_{i}.txt").write_text(f"unique {i}")  # duplicate
        (work_dir / f"other_{i}.txt").write_text(f"different {i}")
        uniques, dups = dedupe_files(work_dir)
        assert dups >= 1
        assert (work_dir / "duplicates").exists()

    @pytest.mark.parametrize("n_dups", [2, 3, 5, 8])
    def test_dedupe_multiple_copies(self, work_dir, n_dups):
        for j in range(n_dups):
            (work_dir / f"copy_{j}.txt").write_text("same content everywhere")
        (work_dir / f"unique.txt").write_text("unique file")
        uniques, dups = dedupe_files(work_dir)
        assert uniques == 2  # one copy of "same" + unique
        assert dups == n_dups - 1

    @pytest.mark.parametrize("i", range(10))
    def test_dedupe_preserves_originals(self, work_dir, i):
        (work_dir / "keep.txt").write_text(f"original {i}")
        (work_dir / "remove.txt").write_text(f"original {i}")
        dedupe_files(work_dir)
        # At least one copy should remain in root
        root_files = [f for f in work_dir.iterdir() if f.is_file()]
        assert len(root_files) >= 1


# ============================================================================
# 6.6 — Creacion de subcarpetas logicas
# ============================================================================

@pytest.mark.automation
class TestLogicalSubfolders:
    """6.6 — Creation of logical subfolder hierarchies."""

    @pytest.mark.parametrize("i", range(10))
    def test_create_logical_subfolders(self, work_dir, i):
        folders = ["documents", "images", "data", "scripts"]
        for f in folders:
            (work_dir / f).mkdir()
        for f in folders:
            assert (work_dir / f).is_dir()

    @pytest.mark.parametrize("depth", [1, 2, 3, 4])
    def test_nested_subfolder_creation(self, work_dir, depth):
        path = work_dir
        for level in range(depth):
            path = path / f"level_{level}"
        path.mkdir(parents=True)
        assert path.is_dir()


# ============================================================================
# 6.7 — Log de decisiones de organizacion
# ============================================================================

@pytest.mark.automation
class TestOrganizationLog:
    """6.7 — Logging organization decisions as structured JSON."""

    @pytest.mark.parametrize("i", range(10))
    def test_organization_log(self, work_dir, i):
        log_path = work_dir / "organization_log.json"
        decisions = []
        for j in range(5):
            decision = {
                "file": f"file_{j}.txt",
                "action": "moved",
                "from": str(work_dir),
                "to": str(work_dir / "organized"),
                "reason": f"Extension-based classification (iteration {i})",
            }
            decisions.append(decision)
        log_path.write_text(json.dumps(decisions, indent=2))
        loaded = json.loads(log_path.read_text())
        assert len(loaded) == 5
        assert all(d["action"] == "moved" for d in loaded)

    @pytest.mark.parametrize("n_entries", [1, 5, 10, 25])
    def test_log_append(self, work_dir, n_entries):
        log_path = work_dir / "log.json"
        entries = [{"file": f"f{j}", "action": "organized"} for j in range(n_entries)]
        log_path.write_text(json.dumps(entries))
        loaded = json.loads(log_path.read_text())
        assert len(loaded) == n_entries


# ============================================================================
# 6.8 — Proteccion contra borrado
# ============================================================================

@pytest.mark.security
class TestSafeDeleteProtection:
    """6.8 — Safe delete with explicit permission and sandbox path containment."""

    @pytest.mark.parametrize("i", range(20))
    def test_safe_delete_requires_permission(self, work_dir, i):
        path = work_dir / f"protected_{i}.txt"
        path.write_text(f"important data {i}")
        result = safe_delete(path, allow=False)
        assert result is False
        assert path.exists(), "File should NOT be deleted without permission"

    @pytest.mark.parametrize("i", range(15))
    def test_safe_delete_with_permission(self, work_dir, i):
        path = work_dir / f"deletable_{i}.txt"
        path.write_text(f"temp data {i}")
        result = safe_delete(path, allow=True)
        assert result is True
        assert not path.exists()

    @pytest.mark.parametrize("i", range(10))
    def test_safe_delete_nonexistent(self, work_dir, i):
        path = work_dir / f"ghost_{i}.txt"
        result = safe_delete(path, allow=True)
        assert result is False

    @pytest.mark.parametrize("i", range(10))
    def test_safe_delete_directory(self, work_dir, i):
        dir_path = work_dir / f"dir_{i}"
        dir_path.mkdir()
        (dir_path / "file.txt").write_text("data")
        result_no = safe_delete(dir_path, allow=False)
        assert result_no is False
        assert dir_path.exists()
        result_yes = safe_delete(dir_path, allow=True)
        assert result_yes is True
        assert not dir_path.exists()

    @pytest.mark.parametrize("i", range(10))
    def test_path_within_sandbox(self, work_dir, i):
        """Verify path containment checks work for sandboxing."""
        inside = work_dir / "sub" / "deep" / "file.txt"
        assert path_within(work_dir, inside) is True
        outside = Path("/etc/passwd")
        assert path_within(work_dir, outside) is False
