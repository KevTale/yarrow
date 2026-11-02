"""Where the runs are kept: a JSON file, ~/.pace/runs.json or $PACE_FILE."""

from __future__ import annotations

import json
import os
from datetime import date
from pathlib import Path

from pace.runs import Run


def path() -> Path:
    return Path(os.environ.get("PACE_FILE") or Path.home() / ".pace" / "runs.json")


def load() -> list[Run]:
    file = path()
    if not file.exists():
        return []
    rows = json.loads(file.read_text(encoding="utf-8"))
    return [
        Run(day=date.fromisoformat(row["date"]), km=row["km"], seconds=row["seconds"], note=row.get("note", ""))
        for row in rows
    ]


def save(runs: list[Run]) -> None:
    file = path()
    file.parent.mkdir(parents=True, exist_ok=True)
    rows = [
        {"date": run.day.isoformat(), "km": run.km, "seconds": run.seconds, "note": run.note}
        for run in sorted(runs, key=lambda run: run.day)
    ]
    file.write_text(json.dumps(rows, indent=2) + "\n", encoding="utf-8")
