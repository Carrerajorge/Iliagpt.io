"""Pytest fixtures shared by the Cowork-style suite."""
import os
import pathlib
import pytest

BASE = pathlib.Path(__file__).parent
ARTIFACTS = BASE / "artifacts"
ARTIFACTS.mkdir(exist_ok=True)


@pytest.fixture(scope="session")
def artifacts_dir():
    return ARTIFACTS


@pytest.fixture(scope="session")
def tmp_doc_dir(tmp_path_factory):
    return tmp_path_factory.mktemp("generated_docs")
