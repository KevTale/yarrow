"""Runs, and how distances and times are read and written."""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date

KM_PER_MILE = 1.609344


@dataclass
class Run:
    day: date
    km: float
    seconds: int
    note: str = ""

    @property
    def pace(self) -> float:
        """Seconds per kilometer."""
        return self.seconds / self.km


def parse_distance(text: str) -> float:
    """'5k', '10.5km', '3mi' or '5000m', in kilometers."""
    match = re.fullmatch(r"\s*(\d+(?:\.\d+)?)\s*(k|km|mi|m)?\s*", text.lower())
    if not match:
        raise ValueError(f"not a distance: {text!r} (try 5k, 3mi or 5000m)")
    value, unit = float(match[1]), match[2] or "km"
    km = {"k": value, "km": value, "mi": value * KM_PER_MILE, "m": value / 1000}[unit]
    if km <= 0:
        raise ValueError("a run is longer than that")
    return round(km, 3)


def parse_duration(text: str) -> int:
    """'25:30' or '1:02:45', in seconds."""
    parts = text.strip().split(":")
    if len(parts) not in (2, 3) or not all(part.isdigit() for part in parts):
        raise ValueError(f"not a time: {text!r} (try 25:30 or 1:02:45)")
    numbers = [int(part) for part in parts]
    if any(number >= 60 for number in numbers[1:]):
        raise ValueError(f"not a time: {text!r}")
    seconds = 0
    for number in numbers:
        seconds = seconds * 60 + number
    if seconds == 0:
        raise ValueError("a run takes longer than that")
    return seconds


def format_duration(seconds: float) -> str:
    """1:02:45, or 25:30 under an hour."""
    total = round(seconds)
    hours, rest = divmod(total, 3600)
    minutes, secs = divmod(rest, 60)
    return f"{hours}:{minutes:02}:{secs:02}" if hours else f"{minutes}:{secs:02}"


def format_pace(seconds_per_km: float) -> str:
    """5:06, minutes and seconds per kilometer."""
    minutes, secs = divmod(round(seconds_per_km), 60)
    return f"{minutes}:{secs:02}"
