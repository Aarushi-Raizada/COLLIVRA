"""
Converters transforming domain simulation objects into shared orbital_core schemas.
"""

from orbital_core.schemas import StateVectorRecord

from .schemas import SyntheticFragmentRecord


def fragment_to_state_vector(
    fragment: SyntheticFragmentRecord,
    status: str = "OK",
    sgp4_error_code: int = 0,
) -> StateVectorRecord:
    """
    Convert a domain SyntheticFragmentRecord into a StateVectorRecord for
    compatibility with shared orbital propagation and conjunction screening interfaces.

    Note on Schema Compatibility & Provenance:
    - 'status' (default 'OK') and 'sgp4_error_code' (default 0) are compatibility values
      for the shared StateVectorRecord data contract. They do NOT indicate that SGP4
      generated or propagated this synthetic fragment.
    - 'norad_cat_id' is explicitly None, reflecting that synthetic fragments do not possess
      assigned NORAD catalog IDs.
    - Full physical simulation provenance is preserved in the domain SyntheticFragmentRecord
      (where is_synthetic=True).
    """
    return StateVectorRecord(
        norad_cat_id=None,
        object_id=fragment.fragment_id,
        object_name=f"Synthetic Fragment {fragment.fragment_id}",
        epoch=fragment.epoch,
        frame=fragment.frame,
        position_km=fragment.position_km,
        velocity_kms=fragment.velocity_kms,
        status=status,
        sgp4_error_code=sgp4_error_code,
    )


def fragments_to_state_vectors(
    fragments: list[SyntheticFragmentRecord],
    status: str = "OK",
    sgp4_error_code: int = 0,
) -> list[StateVectorRecord]:
    """
    Convert a sequence of SyntheticFragmentRecord objects into StateVectorRecord objects.
    """
    return [
        fragment_to_state_vector(f, status=status, sgp4_error_code=sgp4_error_code)
        for f in fragments
    ]
