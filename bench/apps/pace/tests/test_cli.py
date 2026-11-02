import json

import pytest

from pace.cli import main
from pace.runs import format_duration, format_pace, parse_distance, parse_duration


@pytest.fixture(autouse=True)
def runs_file(tmp_path, monkeypatch):
    file = tmp_path / "runs.json"
    monkeypatch.setenv("PACE_FILE", str(file))
    return file


def test_reads_distances():
    assert parse_distance("5k") == 5
    assert parse_distance("10.5km") == 10.5
    assert parse_distance("3mi") == 4.828
    assert parse_distance("5000m") == 5
    with pytest.raises(ValueError):
        parse_distance("far")


def test_reads_times():
    assert parse_duration("25:30") == 1530
    assert parse_duration("1:02:45") == 3765
    with pytest.raises(ValueError):
        parse_duration("25:70")


def test_writes_times_and_paces():
    assert format_duration(1530) == "25:30"
    assert format_duration(3765) == "1:02:45"
    assert format_pace(306) == "5:06"


def test_add_then_list(runs_file, capsys):
    assert main(["add", "5k", "25:30", "--date", "2026-10-20", "--note", "easy"]) == 0
    assert main(["add", "10k", "52:10", "--date", "2026-10-22"]) == 0
    assert json.loads(runs_file.read_text())[0]["date"] == "2026-10-20"
    capsys.readouterr()
    assert main(["list"]) == 0
    lines = capsys.readouterr().out.splitlines()
    assert lines[1].startswith("2026-10-22")
    assert "easy" in lines[2]


def test_stats(capsys):
    main(["add", "5k", "25:00", "--date", "2026-10-20"])
    main(["add", "5k", "27:00", "--date", "2026-10-21"])
    capsys.readouterr()
    main(["stats"])
    out = capsys.readouterr().out
    assert "Runs:          2" in out
    assert "Average pace:  5:12 /km" in out


def test_refuses_a_bad_time(capsys):
    assert main(["add", "5k", "soon"]) == 2
    assert "not a time" in capsys.readouterr().err
