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

    # Groupmates split one model's runs (by defense or by attacker goal) and each sent a CSV:
    # merge them into one table
    uv run matrix_table.py --combine results/haiku_part1.csv results/haiku_part2.csv

    # Only count attacks on clean-pass tasks: the user tasks the agent completes with no
    # attack and no defense. The same tasks are used for every defense. Works with --combine.
    uv run matrix_table.py --capable results/matrix_qwen3-8b-16k-reasoning-none_banking_important_instructions.csv
"""

import csv
import glob
from pathlib import Path

import click

HEADER = ["Defense", "Utility", "ASR", "ASR + announced", "Reached"]
FOOTNOTE = "ASR + announced also counts runs where the agent said it would do the attack but stopped first."


def pct(n: int, d: int) -> str:
    return "n/a" if d == 0 else f"{100 * n / d:.0f}% ({n}/{d})"


def format_table(rows: list[dict], utility_rows: list[dict] | None = None) -> str:
    """Summarize per-run rows (as defense_matrix.py builds them) into a Markdown table.

    Each row needs: defense, repeat, user_task, baseline_utility, attack_success, reached,
    announced. Booleans may be None when unknown. Defenses keep their order of appearance.
    The Utility column is computed from `utility_rows` when given (e.g. all tasks, while the
    attack columns use a filtered subset), otherwise from `rows`.
    """
    defenses = list(dict.fromkeys(r["defense"] for r in rows))
    table = []
    for d in defenses:
        rs = [r for r in rows if r["defense"] == d]
        # Baseline utility counts each (user task, repeat) once per source file, not once per
        # injection task. When combined CSVs each ran the same baselines, each run counts.
        base = {
            (r.get("source"), r["user_task"], r["repeat"]): r["baseline_utility"]
            for r in (utility_rows if utility_rows is not None else rows)
            if r["defense"] == d and r["baseline_utility"] is not None
        }
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


def clean_pass_tasks(rows: list[dict]) -> list[str] | None:
    """User tasks the agent completed with no attack and no defense, or None without a 'none' row.

    With several repeats or combined CSVs, a task counts only if every recorded no-defense
    baseline for it passed.
    """
    results: dict[str, list[bool]] = {}
    for r in rows:
        if r["defense"] == "none" and r["baseline_utility"] is not None:
            results.setdefault(r["user_task"], []).append(r["baseline_utility"])
    if not results:
        return None
    return sorted((t for t, ok in results.items() if all(ok)), key=lambda t: int(t.rsplit("_", 1)[-1]))


def print_table(title: str, rows: list[dict], capable: bool) -> None:
    click.echo(f"{title}\n")
    if not rows:
        click.echo("(no rows)")
        return
    if not capable:
        click.echo(format_table(rows))
        return
    tasks = clean_pass_tasks(rows)
    if tasks is None:
        click.echo("--capable needs the no-defense runs ('none'), which this data doesn't have.")
        return
    kept = [r for r in rows if r["user_task"] in tasks]
    click.echo(f"Capability-qualified: attacks on the {len(tasks)} clean-pass tasks only "
               f"({', '.join(t.removeprefix('user_task_') for t in tasks)}), same tasks for every defense.")
    click.echo("Utility is still measured on all tasks.\n")
    click.echo(format_table(kept, utility_rows=rows) if kept else "(no attacks on clean-pass tasks)")


@click.command()
@click.argument("csv_files", nargs=-1, required=True)
@click.option("--combine", is_flag=True,
              help="Merge all CSVs into one table (for one model's runs split across people)")
@click.option("--capable", is_flag=True,
              help="Only count attacks on tasks the agent completes with no attack and no defense")
def main(csv_files, combine, capable):
    # PowerShell doesn't expand wildcards like results/*.csv, so do it here.
    paths = [Path(p) for pattern in csv_files for p in (sorted(glob.glob(pattern)) or [pattern])]
    for path in paths:
        if not path.is_file():
            raise click.BadParameter(f"no such file: {path}")

    if combine:
        rows = []
        for path in paths:
            part = read_rows(path)
            for r in part:
                r["source"] = path.name
            rows += part
        keys = [(r["defense"], r["repeat"], r["user_task"], r["injection_task"]) for r in rows]
        if len(keys) != len(set(keys)):
            click.echo("Warning: some runs appear in more than one CSV and are counted more than once.\n")
        print_table(f"combined: {', '.join(p.name for p in paths)}", rows, capable)
        click.echo(f"\n{FOOTNOTE}")
        return

    for i, path in enumerate(paths):
        if i:
            click.echo()
        print_table(path.stem.removeprefix("matrix_"), read_rows(path), capable)
    click.echo(f"\n{FOOTNOTE}")


if __name__ == "__main__":
    main()
