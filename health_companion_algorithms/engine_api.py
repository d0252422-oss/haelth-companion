"""Opt-in WSGI read API. Authentication is supplied by the existing trusted host."""

from __future__ import annotations

import json
from collections.abc import Callable, Iterable
from datetime import date
from typing import Any
from urllib.parse import parse_qs

from .domain_engines import VERSIONS
from .engine_store import EngineStore


def create_app(store: EngineStore, authenticate: Callable[[dict[str, Any]], str | None]) -> Any:
    """No default authentication, no network binding, no production activation."""

    def app(environ: dict[str, Any], start_response: Any) -> Iterable[bytes]:
        status = "200 OK"
        try:
            subject = authenticate(environ)
            if not subject:
                raise PermissionError
            if environ.get("REQUEST_METHOD") != "GET":
                status, result = "405 Method Not Allowed", {"error": "READ_ONLY_API"}
            else:
                prefix = "/v1/engine/domain-scores/"
                path = environ.get("PATH_INFO", "")
                domain = path[len(prefix) :] if path.startswith(prefix) else ""
                if domain not in VERSIONS:
                    status, result = "404 Not Found", {"error": "UNKNOWN_DOMAIN"}
                else:
                    query = parse_qs(environ.get("QUERY_STRING", ""), keep_blank_values=True)
                    if set(query) != {"start", "end", "version"} or any(
                        len(values) != 1 for values in query.values()
                    ):
                        raise ValueError("bounded dates and version required")
                    version = query["version"][0]
                    if not version or len(version) > 128:
                        raise ValueError("invalid version")
                    result = store.domain_api(
                        subject,
                        domain,
                        date.fromisoformat(query["start"][0]),
                        date.fromisoformat(query["end"][0]),
                        version,
                    )
        except PermissionError:
            status, result = "401 Unauthorized", {"error": "AUTHENTICATION_REQUIRED"}
        except (ValueError, KeyError):
            status, result = "400 Bad Request", {"error": "INVALID_SCOPE"}
        except Exception:
            status, result = "500 Internal Server Error", {"error": "ENGINE_READ_FAILED"}
        payload = json.dumps(result, allow_nan=False, separators=(",", ":")).encode()
        start_response(
            status,
            [
                ("Content-Type", "application/json"),
                ("Cache-Control", "private, no-store"),
                ("Content-Length", str(len(payload))),
            ],
        )
        return [payload]

    return app
