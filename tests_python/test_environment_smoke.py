"""Import-only smoke test for the algorithm-engine development environment."""

from importlib import import_module

import pytest


@pytest.mark.parametrize(
    "module_name",
    [
        "numpy",
        "pandas",
        "scipy",
        "sklearn",
        "statsmodels",
        "pydantic",
        "sqlalchemy",
        "psycopg",
        "httpx",
        "pyarrow",
    ],
)
def test_required_runtime_dependency_imports(module_name: str) -> None:
    """Every required runtime dependency imports without external I/O."""
    assert import_module(module_name) is not None


@pytest.mark.parametrize("module_name", ["pytest", "hypothesis"])
def test_required_test_dependency_imports(module_name: str) -> None:
    """The Python testing baseline imports without external I/O."""
    assert import_module(module_name) is not None
