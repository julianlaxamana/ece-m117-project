"""Print the defense comparison table from a results CSV, without rerunning anything.

defense_matrix.py writes one row per attacked run to results/matrix_<model>_<suite>_<attack>.csv
and prints this same table at the end. Use this script to see the table again, or to build it
from a CSV a groupmate sent you.

Examples:
    uv run matrix_table.py results/matrix_qwen3-8b-16k-reasoning-none_banking_important_instructions.csv

    # Every CSV in results/, one table each
    uv run matrix_table.py results/*.csv

    # Save as Markdown to paste into a report or slides
    uv run matrix_table.py results/matrix_qwen3-8b-16k-reasoning-none_banking_important_instructions.csv > table.md
"""

import csv
import glob
from pathlib import Path

import click

HEADER = ["Defense", "Utility", "ASR", "ASR + announced", "Reached"]
FOOTNOTE = "ASR + announced also counts runs where the agent said it would do the attack but stopped first."


def pct(n: int, d: int) -> str:
    return "n/a" if d == 0 else f"{100 * n / d:.0f}% ({n}/{d})"


def format_table(rows: list[dict]) -> str:
    """Summarize per-run rows (as defense_matrix.py builds them) into a Markdown table.

    Each row needs: defense, repeat, user_task, baseline_utility, attack_success, reached,
    announced. Booleans may be None when unknown. Defenses keep their order of appearance.
    """
    defenses = list(dict.fromkeys(r["defense"] for r in rows))
    table = []
    for d in defenses:
        rs = [r for r in rows if r["defense"] == d]
        # Baseline utility counts each (user task, repeat) once, not once per injection task.
        base = {(r["user_task"], r["repeat"]): r["baseline_utility"] for r in rs if r["baseline_utility"] is not None}
        table.append([
            d,
            pct(sum(base.values()), len(base)),
            pct(sum(r["attack_success"] for r in rs), len(rs)),
            pct(sum(r["attack_success"] or bool(r["announced"]) for r in rs), len(rs)),
            pct(sum(r["reached"] for r in rs), len(rs)),
        ])

    widths = [max(len(str(x)) for x in col) for col in zip(HEADER, *table)]

    def line(cells):
        return "| " + " | ".join(str(c).ljust(w) for c, w in zip(cells, widths)) + " |"

    sep = "|" + "|".join("-" * (w + 2) for w in widths) + "|"
    return "\n".join([line(HEADER), sep, *(line(row) for row in table)])


def _bool(value: str) -> bool | None:
    """CSV cells are 'True', 'False' or '' (unknown)."""
    return {"True": True, "False": False}.get(value)


def read_rows(path: Path) -> list[dict]:
    with path.open(newline="") as f:
        rows = list(csv.DictReader(f))
    for r in rows:
        for key in ("baseline_utility", "utility_under_attack", "attack_success", "reached", "announced"):
            if key in r:
                r[key] = _bool(r[key])
        r.setdefault("announced", None)  # CSVs from before the announced column
    return rows


@click.command()
@click.argument("csv_files", nargs=-1, required=True)
def main(csv_files):
    # PowerShell doesn't expand wildcards like results/*.csv, so do it here.
    paths = [Path(p) for pattern in csv_files for p in (sorted(glob.glob(pattern)) or [pattern])]
    for i, path in enumerate(paths):
        if not path.is_file():
            raise click.BadParameter(f"no such file: {path}")
        rows = read_rows(path)
        if i:
            click.echo()
        click.echo(f"{path.stem.removeprefix('matrix_')}\n")
        click.echo(format_table(rows) if rows else "(no rows)")
    click.echo(f"\n{FOOTNOTE}")


if __name__ == "__main__":
    main()
