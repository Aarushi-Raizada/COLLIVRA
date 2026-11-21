"""
CelesTrak GP/OMM API Client with Disk Caching and Offline Fixture Fallback.

Supports retrieving orbital records in OMM JSON format by GROUP or CATNR,
parsing them into validated OrbitalObjectRecord Pydantic models, caching them
to local disk with a configurable TTL, and transparently falling back to
offline fixtures when network access is unavailable, rate-limited, or offline.
"""

from __future__ import annotations

import json
import logging
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx

from orbital_core.schemas import OrbitalObjectRecord

logger = logging.getLogger("orbital_core.celestrak")

CELESTRAK_GP_URL: str = "https://celestrak.org/NORAD/elements/gp.php"
DEFAULT_CACHE_TTL_SECONDS: int = 7200  # 2 hours (matches CelesTrak update cadence)
DEFAULT_TIMEOUT_SECONDS: float = 25.0
DEFAULT_USER_AGENT: str = "ZORBIT-SSA-Research/0.1.0"
MAX_TRANSIENT_RETRIES: int = 2  # Maximum total attempts for transient connection/timeout errors
INITIAL_BACKOFF_SECONDS: float = 0.5  # Short exponential backoff interval

# Mapping of common CelesTrak group names to local offline fixtures
FIXTURE_MAP: dict[str, str] = {
    "stations": "stations_omm.json",
    "station": "stations_omm.json",
    "starlink": "starlink_sample_omm.json",
    "starlink_sample": "starlink_sample_omm.json",
    "cosmos-2251-debris": "debris_cosmos_omm.json",
    "cosmos_2251_debris": "debris_cosmos_omm.json",
    "debris": "debris_cosmos_omm.json",
    "debris_cosmos": "debris_cosmos_omm.json",
}


class CelesTrakError(Exception):
    """Base exception for all CelesTrak client errors."""


class CelesTrakFetchError(CelesTrakError):
    """Raised when data cannot be retrieved from network, cache, or fixtures."""


class CelesTrakParseError(CelesTrakError):
    """Raised when response payload is malformed or cannot be parsed into schemas."""


def deduplicate_records(records: list[OrbitalObjectRecord]) -> list[OrbitalObjectRecord]:
    """
    Deduplicate a list of OrbitalObjectRecord items by norad_cat_id.
    When duplicate IDs are encountered, keeps the record with the latest epoch.
    """
    deduped: dict[str, OrbitalObjectRecord] = {}
    for record in records:
        norad_id = record.norad_cat_id
        if norad_id not in deduped:
            deduped[norad_id] = record
        else:
            if record.epoch > deduped[norad_id].epoch:
                deduped[norad_id] = record
    return list(deduped.values())


class CelesTrakClient:
    """
    Client for interacting with CelesTrak GP/OMM JSON endpoints.
    Provides intelligent disk caching and offline fixture fallback.
    """

    def __init__(
        self,
        cache_dir: Path | str | None = None,
        fixtures_dir: Path | str | None = None,
        cache_ttl_seconds: int = DEFAULT_CACHE_TTL_SECONDS,
        timeout: float = DEFAULT_TIMEOUT_SECONDS,
        user_agent: str = DEFAULT_USER_AGENT,
        base_url: str = CELESTRAK_GP_URL,
    ) -> None:
        if cache_dir is None:
            # Default to .cache/celestrak in repository root or user home
            repo_root = Path(__file__).resolve().parents[3]
            self.cache_dir = repo_root / ".cache" / "celestrak"
        else:
            self.cache_dir = Path(cache_dir)

        if fixtures_dir is None:
            repo_root = Path(__file__).resolve().parents[3]
            self.fixtures_dir = repo_root / "data" / "fixtures"
        else:
            self.fixtures_dir = Path(fixtures_dir)

        self.cache_ttl_seconds = cache_ttl_seconds
        self.timeout = timeout
        self.user_agent = user_agent
        self.base_url = base_url

        self.cache_dir.mkdir(parents=True, exist_ok=True)

    def _sanitize_key(self, key: str) -> str:
        """Sanitize a cache key for use in a filesystem path."""
        return re.sub(r"[^\w\-.]", "_", key.lower())

    def _get_cache_path(self, query_type: str, query_value: str) -> Path:
        """Return the path to the cached JSON file for a given query."""
        safe_val = self._sanitize_key(str(query_value))
        return self.cache_dir / f"{query_type}_{safe_val}.json"

    def _read_cache(
        self, query_type: str, query_value: str, allow_expired: bool = False
    ) -> tuple[list[dict[str, Any]], datetime] | None:
        """
        Read cached JSON if present and valid.
        Returns (data_list, cached_at) or None.
        """
        cache_file = self._get_cache_path(query_type, query_value)
        if not cache_file.exists():
            return None

        try:
            with open(cache_file, "r", encoding="utf-8") as f:
                content = json.load(f)

            if not isinstance(content, dict) or "payload" not in content:
                logger.warning("Cache file %s corrupted; ignoring.", cache_file)
                return None

            cached_at_str = content.get("cached_at")
            if not cached_at_str:
                return None

            cached_at = datetime.fromisoformat(cached_at_str)
            if cached_at.tzinfo is None:
                cached_at = cached_at.replace(tzinfo=timezone.utc)

            now = datetime.now(timezone.utc)
            age = (now - cached_at).total_seconds()

            if not allow_expired and age > self.cache_ttl_seconds:
                logger.debug(
                    "Cache for %s:%s is expired (age %.1fs > ttl %ds)",
                    query_type,
                    query_value,
                    age,
                    self.cache_ttl_seconds,
                )
                return None

            payload = content["payload"]
            if not isinstance(payload, list):
                payload = [payload]

            return payload, cached_at

        except Exception as e:
            logger.warning("Error reading cache file %s: %s", cache_file, e)
            return None

    def _write_cache(
        self, query_type: str, query_value: str, payload: list[dict[str, Any]] | dict[str, Any]
    ) -> None:
        """Write raw response data to disk cache."""
        cache_file = self._get_cache_path(query_type, query_value)
        try:
            envelope = {
                "query_type": query_type,
                "query_value": str(query_value),
                "cached_at": datetime.now(timezone.utc).isoformat(),
                "payload": payload,
            }
            with open(cache_file, "w", encoding="utf-8") as f:
                json.dump(envelope, f, indent=2)
            logger.debug("Wrote cache for %s:%s to %s", query_type, query_value, cache_file)
        except Exception as e:
            logger.warning("Failed to write cache to %s: %s", cache_file, e)

    def _fetch_live(self, params: dict[str, str]) -> list[dict[str, Any]]:
        """
        Execute live HTTP GET against CelesTrak with up to MAX_TRANSIENT_RETRIES attempts
        for transient network/timeout errors.

        Does NOT retry on 403, 404, HTTPStatusError, or malformed JSON payloads.
        Returns parsed raw JSON list of dicts.
        Raises CelesTrakFetchError or CelesTrakParseError on failure.
        """
        headers = {"User-Agent": self.user_agent}
        request_params = {**params, "FORMAT": "JSON"}

        last_transient_error: Exception | None = None

        for attempt in range(1, MAX_TRANSIENT_RETRIES + 1):
            try:
                with httpx.Client(
                    timeout=httpx.Timeout(self.timeout, connect=5.0),
                    headers=headers,
                    follow_redirects=True,
                ) as client:
                    response = client.get(self.base_url, params=request_params)

                    # 404 or "No GP data found": permanent response, do NOT retry
                    if response.status_code == 404 or "No GP data found" in response.text:
                        logger.info("CelesTrak returned no data for query: %s", params)
                        return []

                    # 403 Rate Limited: permanent for current window, do NOT retry
                    if response.status_code == 403:
                        msg = f"CelesTrak rate-limited (HTTP 403): {response.text.strip()}"
                        logger.warning(msg)
                        raise CelesTrakFetchError(msg)

                    response.raise_for_status()

                    try:
                        data = response.json()
                    except Exception as json_err:
                        # Malformed JSON: client/server payload error, do NOT retry
                        raise CelesTrakParseError(
                            f"Failed to decode CelesTrak JSON response: {json_err}"
                        ) from json_err

                    if isinstance(data, dict):
                        return [data]
                    elif isinstance(data, list):
                        return data
                    else:
                        raise CelesTrakParseError(f"Unexpected JSON data type: {type(data)}")

            except (httpx.TimeoutException, httpx.ConnectError) as transient_err:
                last_transient_error = transient_err
                if attempt < MAX_TRANSIENT_RETRIES:
                    backoff = INITIAL_BACKOFF_SECONDS * (2 ** (attempt - 1))
                    logger.warning(
                        "Transient network failure on attempt %d/%d (%s). Retrying in %.2fs...",
                        attempt,
                        MAX_TRANSIENT_RETRIES,
                        transient_err,
                        backoff,
                    )
                    time.sleep(backoff)
                else:
                    logger.warning(
                        "Transient network failure on attempt %d/%d (%s). Retries exhausted.",
                        attempt,
                        MAX_TRANSIENT_RETRIES,
                        transient_err,
                    )
            except httpx.HTTPStatusError as status_err:
                raise CelesTrakFetchError(
                    f"CelesTrak HTTP status error: {status_err}"
                ) from status_err
            except (CelesTrakFetchError, CelesTrakParseError):
                raise
            except Exception as err:
                raise CelesTrakFetchError(
                    f"Unexpected error communicating with CelesTrak: {err}"
                ) from err

        if last_transient_error is not None:
            raise CelesTrakFetchError(
                f"CelesTrak network error after {MAX_TRANSIENT_RETRIES} attempts: "
                f"{last_transient_error}"
            ) from last_transient_error

        return []

    def get_from_fixture(self, fixture_name_or_group: str) -> list[OrbitalObjectRecord]:
        """
        Load records from an offline JSON fixture file in fixtures_dir.
        Sets data_source="OFFLINE_FIXTURE".
        """
        fname = FIXTURE_MAP.get(fixture_name_or_group.lower(), fixture_name_or_group)
        if not fname.endswith(".json"):
            fname = f"{fname}.json"

        fpath = self.fixtures_dir / fname
        if not fpath.exists():
            raise CelesTrakFetchError(f"Offline fixture '{fname}' not found in {self.fixtures_dir}")

        try:
            with open(fpath, "r", encoding="utf-8") as f:
                data = json.load(f)

            if isinstance(data, dict):
                data = [data]
            elif not isinstance(data, list):
                raise CelesTrakParseError(f"Fixture {fpath} contains non-list data: {type(data)}")

            file_mtime = datetime.fromtimestamp(fpath.stat().st_mtime, tz=timezone.utc)
            records = [
                OrbitalObjectRecord.from_omm_dict(
                    item,
                    data_source="OFFLINE_FIXTURE",
                    retrieved_at=file_mtime,
                )
                for item in data
            ]
            return records

        except Exception as e:
            if isinstance(e, (CelesTrakError, CelesTrakParseError)):
                raise
            raise CelesTrakParseError(f"Failed to parse offline fixture {fpath}: {e}") from e

    def find_in_fixtures(self, norad_id: str | int) -> OrbitalObjectRecord | None:
        """
        Search all available offline fixtures for an object matching norad_id.
        """
        target_id = str(norad_id).strip()
        if not self.fixtures_dir.exists():
            return None

        for json_path in self.fixtures_dir.glob("*.json"):
            try:
                with open(json_path, "r", encoding="utf-8") as f:
                    content = json.load(f)
                if isinstance(content, dict):
                    content = [content]
                if not isinstance(content, list):
                    continue

                for item in content:
                    if not isinstance(item, dict):
                        continue
                    cat_id = str(item.get("NORAD_CAT_ID", "")).strip()
                    if cat_id == target_id:
                        file_mtime = datetime.fromtimestamp(
                            json_path.stat().st_mtime, tz=timezone.utc
                        )
                        return OrbitalObjectRecord.from_omm_dict(
                            item,
                            data_source="OFFLINE_FIXTURE",
                            retrieved_at=file_mtime,
                        )
            except Exception as e:
                logger.debug("Skipping unreadable fixture %s: %s", json_path, e)

        return None

    def get_by_group(
        self,
        group: str,
        force_refresh: bool = False,
        use_cache: bool = True,
        fallback_to_fixture: bool = True,
        deduplicate: bool = True,
    ) -> list[OrbitalObjectRecord]:
        """
        Retrieve orbital records for a satellite group (e.g. 'stations', 'starlink').

        1. If use_cache and not force_refresh, check valid disk cache.
        2. Attempt live query to CelesTrak GP API.
        3. On live success, write cache and return records (data_source="LIVE").
        4. On live failure, attempt stale cache fallback (data_source="CACHE").
        5. If fallback_to_fixture, attempt offline fixture fallback (data_source="OFFLINE_FIXTURE").
        6. If all fail, raise CelesTrakFetchError.
        """
        group_key = group.strip().lower()

        # Step 1: Fresh cache lookup
        if use_cache and not force_refresh:
            cached = self._read_cache("group", group_key, allow_expired=False)
            if cached is not None:
                payload, cached_at = cached
                logger.info("Serving group '%s' from valid cache (%d objects)", group, len(payload))
                records = [
                    OrbitalObjectRecord.from_omm_dict(
                        item, data_source="CACHE", retrieved_at=cached_at
                    )
                    for item in payload
                ]
                return deduplicate_records(records) if deduplicate else records

        # Step 2: Attempt live fetch
        live_error: Exception | None = None
        try:
            logger.info("Querying live CelesTrak for group '%s'...", group)
            raw_list = self._fetch_live({"GROUP": group})
            now = datetime.now(timezone.utc)

            # Update disk cache
            if use_cache and raw_list:
                self._write_cache("group", group_key, raw_list)

            records = [
                OrbitalObjectRecord.from_omm_dict(item, data_source="LIVE", retrieved_at=now)
                for item in raw_list
            ]
            return deduplicate_records(records) if deduplicate else records

        except Exception as e:
            logger.warning("Live fetch failed for group '%s': %s", group, e)
            live_error = e

        # Step 3: Stale cache fallback
        if use_cache:
            stale_cached = self._read_cache("group", group_key, allow_expired=True)
            if stale_cached is not None:
                payload, cached_at = stale_cached
                logger.warning(
                    "Serving group '%s' from expired cache fallback (%d objects)",
                    group,
                    len(payload),
                )
                records = [
                    OrbitalObjectRecord.from_omm_dict(
                        item, data_source="CACHE", retrieved_at=cached_at
                    )
                    for item in payload
                ]
                return deduplicate_records(records) if deduplicate else records

        # Step 4: Offline fixture fallback
        if fallback_to_fixture:
            try:
                fixture_records = self.get_from_fixture(group_key)
                logger.warning(
                    "Serving group '%s' from offline fixture (%d objects)",
                    group,
                    len(fixture_records),
                )
                return deduplicate_records(fixture_records) if deduplicate else fixture_records
            except Exception as fix_err:
                logger.warning("Fixture fallback failed for group '%s': %s", group, fix_err)

        raise CelesTrakFetchError(
            f"Failed to retrieve orbital data for group '{group}' from live API, "
            f"cache, and fixtures: {live_error}"
        ) from live_error

    def get_by_norad_id(
        self,
        norad_id: str | int,
        force_refresh: bool = False,
        use_cache: bool = True,
        fallback_to_fixture: bool = True,
    ) -> OrbitalObjectRecord | None:
        """
        Retrieve orbital record for a specific NORAD catalog number.

        1. If use_cache and not force_refresh, check valid disk cache.
        2. Attempt live query to CelesTrak GP API.
        3. On live success, write cache and return record (data_source="LIVE").
        4. On live failure, attempt stale cache fallback (data_source="CACHE").
        5. If fallback_to_fixture, search offline fixtures (data_source="OFFLINE_FIXTURE").
        6. If not found or all fail, return None or raise.
        """
        norad_str = str(norad_id).strip()

        # Step 1: Fresh cache lookup
        if use_cache and not force_refresh:
            cached = self._read_cache("catnr", norad_str, allow_expired=False)
            if cached is not None:
                payload, cached_at = cached
                if payload:
                    logger.info("Serving NORAD %s from valid cache", norad_str)
                    return OrbitalObjectRecord.from_omm_dict(
                        payload[0], data_source="CACHE", retrieved_at=cached_at
                    )

        # Step 2: Attempt live fetch
        live_error: Exception | None = None
        try:
            logger.info("Querying live CelesTrak for CATNR %s...", norad_str)
            raw_list = self._fetch_live({"CATNR": norad_str})
            if not raw_list:
                return None

            now = datetime.now(timezone.utc)
            if use_cache:
                self._write_cache("catnr", norad_str, raw_list)

            return OrbitalObjectRecord.from_omm_dict(
                raw_list[0], data_source="LIVE", retrieved_at=now
            )

        except Exception as e:
            logger.warning("Live fetch failed for CATNR %s: %s", norad_str, e)
            live_error = e

        # Step 3: Stale cache fallback
        if use_cache:
            stale_cached = self._read_cache("catnr", norad_str, allow_expired=True)
            if stale_cached is not None:
                payload, cached_at = stale_cached
                if payload:
                    logger.warning("Serving NORAD %s from expired cache fallback", norad_str)
                    return OrbitalObjectRecord.from_omm_dict(
                        payload[0], data_source="CACHE", retrieved_at=cached_at
                    )

        # Step 4: Offline fixture fallback
        if fallback_to_fixture:
            matched = self.find_in_fixtures(norad_str)
            if matched is not None:
                logger.warning("Serving NORAD %s from offline fixture", norad_str)
                return matched

        raise CelesTrakFetchError(
            f"Failed to retrieve NORAD {norad_str} from live API, cache, and fixtures: {live_error}"
        ) from live_error

    def clear_cache(self) -> int:
        """Clear all cached JSON files in cache_dir. Returns count of deleted files."""
        count = 0
        if self.cache_dir.exists():
            for f in self.cache_dir.glob("*.json"):
                try:
                    f.unlink()
                    count += 1
                except Exception as e:
                    logger.warning("Failed to delete cache file %s: %s", f, e)
        return count
