"""pace: a running log in the terminal."""

from __future__ import annotations

import argparse
import sys
from datetime import date

from pace import __version__
from pace.runs import Run, format_duration, format_pace, parse_distance, parse_duration
from pace.store import load, save


def _add(args: argparse.Namespace) -> int:
    try:
        run = Run(
            day=date.fromisoformat(args.date) if args.date else date.today(),
            km=parse_distance(args.distance),
            seconds=parse_duration(args.time),
            note=args.note or "",
        )
    except ValueError as error:
        print(f"pace: {error}", file=sys.stderr)
        return 2
    runs = load()
    runs.append(run)
    save(runs)
    print(f"Added {run.km:g} km in {format_duration(run.seconds)} ({format_pace(run.pace)} /km)")
    return 0


def _list(args: argparse.Namespace) -> int:
    runs = sorted(load(), key=lambda run: run.day, reverse=True)
    if args.last:
        runs = runs[: args.last]
    if not runs:
        print("No runs yet. Add one: pace add 5k 25:30")
        return 0
    print(f"{'Date':<12}{'Distance':>10}{'Time':>10}{'Pace':>10}  Note")
    for run in runs:
        print(
            f"{run.day.isoformat():<12}{run.km:>8g} km{format_duration(run.seconds):>10}"
            f"{format_pace(run.pace):>10}  {run.note}"
        )
    return 0


def _stats(_: argparse.Namespace) -> int:
    runs = load()
    if not runs:
        print("No runs yet. Add one: pace add 5k 25:30")
        return 0
    km = sum(run.km for run in runs)
    seconds = sum(run.seconds for run in runs)
    print(f"Runs:          {len(runs)}")
    print(f"Distance:      {km:g} km")
    print(f"Time:          {format_duration(seconds)}")
    print(f"Average pace:  {format_pace(seconds / km)} /km")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="pace", description="A running log in the terminal.")
    parser.add_argument("--version", action="version", version=f"pace {__version__}")
    commands = parser.add_subparsers(dest="command", required=True)

    add = commands.add_parser("add", help="log a run")
    add.add_argument("distance", help="5k, 10.5km, 3mi or 5000m")
    add.add_argument("time", help="25:30 or 1:02:45")
    add.add_argument("--date", help="YYYY-MM-DD, today when left out")
    add.add_argument("--note", help="a few words about it")
    add.set_defaults(handler=_add)

    listing = commands.add_parser("list", help="the runs, newest first")
    listing.add_argument("--last", type=int, help="only the last N runs")
    listing.set_defaults(handler=_list)

    stats = commands.add_parser("stats", help="totals and average pace")
    stats.set_defaults(handler=_stats)

    args = parser.parse_args(argv)
    return args.handler(args)


if __name__ == "__main__":
    sys.exit(main())
