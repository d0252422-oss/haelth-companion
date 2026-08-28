"""Compute-only JSON bridge for the non-production Python algorithm candidate."""

from __future__ import annotations

import json
import sys

from health_companion_algorithms.runtime import compute_request


def main() -> None:
    json.dump(compute_request(json.load(sys.stdin)), sys.stdout, separators=(",", ":"))


if __name__ == "__main__":
    main()
