# pace

A running log in the terminal: log a run, list them, see your totals.

```
$ pace add 5k 25:30 --note parkrun
Added 5 km in 25:30 (5:06 /km)
$ pace list --last 3
$ pace stats
```

## Install

Python 3.11 or later.

```bash
python -m venv .venv && . .venv/bin/activate
pip install -e ".[dev]"
```

Runs are kept in `~/.pace/runs.json`, or in the file `PACE_FILE` names. To try it on sample data:

```bash
PACE_FILE=examples/runs.json pace list
```

## Distances and times

Distances: `5k`, `10.5km`, `3mi`, `5000m`. Times: `25:30` or `1:02:45`.

## Test

```bash
pytest
```
