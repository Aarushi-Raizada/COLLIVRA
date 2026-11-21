"""Scaffold validation test verifying packages can be imported."""

import orbital_core
import simulation
import zorbit_api


def test_packages_version():
    assert orbital_core.__version__ == "0.1.0"
    assert simulation.__version__ == "0.1.0"
    assert zorbit_api.__version__ == "0.1.0"

