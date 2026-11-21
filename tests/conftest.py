"""Shared Pytest fixtures for ZORBIT test suites."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

FIXTURES_DIR = Path(__file__).resolve().parents[1] / "data" / "fixtures"


@pytest.fixture
def fixtures_dir() -> Path:
    return FIXTURES_DIR


@pytest.fixture
def stations_fixture() -> list[dict]:
    with open(FIXTURES_DIR / "stations_omm.json", "r", encoding="utf-8") as f:
        return json.load(f)


@pytest.fixture
def starlink_fixture() -> list[dict]:
    with open(FIXTURES_DIR / "starlink_sample_omm.json", "r", encoding="utf-8") as f:
        return json.load(f)


@pytest.fixture
def debris_fixture() -> list[dict]:
    with open(FIXTURES_DIR / "debris_cosmos_omm.json", "r", encoding="utf-8") as f:
        return json.load(f)


@pytest.fixture(autouse=True, scope="function")
def isolate_iers_configuration():
    """
    Function-scoped autouse fixture to isolate Astropy IERS configuration for tests.

    Enforces zero unexpected network downloads and disables internal wall-clock
    age expiration by setting:
        iers.conf.auto_download = False
        iers.conf.auto_max_age = None
    Original configuration values are captured and guaranteed to be restored
    in a finally block, ensuring zero configuration leakage between tests.
    """
    from astropy.utils import iers

    orig_auto_download = iers.conf.auto_download
    orig_auto_max_age = iers.conf.auto_max_age
    try:
        iers.conf.auto_download = False
        iers.conf.auto_max_age = None
        yield
    finally:
        iers.conf.auto_download = orig_auto_download
        iers.conf.auto_max_age = orig_auto_max_age

