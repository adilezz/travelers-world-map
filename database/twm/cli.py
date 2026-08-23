"""Command line for the database build.

    twm sources                 what each adapter needs and what it is licensed under
    twm build --config b.json   run the pipeline end to end
    twm inspect --country Nepal what the model chose, and why
    twm conflicts               places that cannot both be holes -- the inset list
"""
from __future__ import annotations

import json
from pathlib import Path

import typer
from rich.console import Console
from rich.table import Table

from twm.config import ARCHETYPES, PARAMS
from twm.geo import PrintedMap

app = typer.Typer(add_completion=False, help="Travelers World Map database build")
console = Console()


@app.command()
def sources() -> None:
    """List adapters, their licences, and whether they may cross a border."""
    from twm.sources.base import registry

    table = Table(title="Source adapters", header_style="bold")
    for col in ("adapter", "licence", "cross-country", "network"):
        table.add_column(col)
    for name, cls in sorted(registry().items()):
        table.add_row(
            name, cls.licence,
            "[green]yes[/]" if cls.cross_country_safe else "[yellow]within country only[/]",
            "download" if cls.requires_network else "operator-supplied file",
        )
    console.print(table)
    console.print(
        "\n[dim]Sources marked 'within country only' rank candidates inside one "
        "country and never between countries: their inclusion criteria are set "
        "nationally, so across a border they measure documentation, not merit.[/]"
    )


@app.command()
def build(
    config: Path = typer.Option(..., exists=True, help="JSON build configuration"),
    out: Path = typer.Option(Path("dist"), help="Output directory"),
    db: Path = typer.Option(Path("twm.duckdb"), help="DuckDB file to write"),
    dry_run: bool = typer.Option(False, help="Load and score, write nothing"),
) -> None:
    """Run the pipeline end to end."""
    from twm.loader import load_from_config
    from twm.pipeline import build as run_build
    from twm.store import Store, export_app, export_printed, export_report

    cfg = json.loads(config.read_text("utf-8"))
    with console.status("loading sources..."):
        candidates, assets, countries, manifest = load_from_config(cfg)
    console.print(f"loaded [bold]{len(candidates)}[/] candidates, "
                  f"[bold]{len(assets)}[/] assets, {len(countries)} countries")

    with console.status("building..."):
        result = run_build(candidates, assets, countries, PARAMS)

    _summary(result)
    if dry_run:
        console.print("[yellow]dry run -- nothing written[/]")
        return

    store = Store(db)
    store.write_places(result.places)
    store.write_manifest({"sources": manifest, "params": PARAMS.__dict__})
    store.close()
    export_app(result, out)
    export_printed(result, out)
    export_report(result, out)
    console.print(f"\nwrote [bold]{db}[/] and exports in [bold]{out}/[/]")


@app.command()
def inspect(
    country: str = typer.Option(..., help="Country to inspect"),
    exports: Path = typer.Option(Path("dist"), help="Directory holding app_places.json"),
    limit: int = typer.Option(25),
) -> None:
    """Show what the model chose for one country, highest score first."""
    payload = json.loads((exports / "app_places.json").read_text("utf-8"))
    rows = [p for p in payload["places"] if p["country"].lower() == country.lower()]
    if not rows:
        console.print(f"[red]no places for {country}[/]")
        raise typer.Exit(1)
    rows.sort(key=lambda p: -p["score"])

    table = Table(title=f"{country} -- {len(rows)} places", header_style="bold")
    for col, just in (("#", "right"), ("place", "left"), ("score", "right"),
                      ("kinds", "left"), ("printed", "center")):
        table.add_column(col, justify=just)
    for i, p in enumerate(rows[:limit], 1):
        kinds = " / ".join(ARCHETYPES.get(a, a) for a in p["archetypes"])
        table.add_row(str(i), p["name"], str(p["score"]), kinds,
                      "[green]yes[/]" if p["on_printed_map"] else "")
    console.print(table)
    printed = sum(1 for p in rows if p["on_printed_map"])
    console.print(f"[dim]{printed} of {len(rows)} reach the printed map[/]")


@app.command()
def conflicts(
    exports: Path = typer.Option(Path("dist")),
    width_m: float = typer.Option(3.0, help="Printed map width in metres"),
) -> None:
    """Places too close to be separate holes -- the regions that need insets."""
    payload = json.loads((exports / "printed_places.json").read_text("utf-8"))
    insets = payload.get("inset_candidates", {})
    if not insets:
        console.print("[green]no conflicts -- every place fits at world scale[/]")
        return
    pm = PrintedMap(width_m)
    table = Table(title=f"Inset panels needed at 1:{pm.scale_denominator/1e6:.1f}M",
                  header_style="bold")
    for col in ("country", "pairs", "closest", "inset magnification"):
        table.add_column(col)
    for country, pairs in sorted(insets.items(), key=lambda kv: -len(kv[1])):
        closest = min(p[2] for p in pairs)
        table.add_row(country, str(len(pairs)), f"{closest:.0f} km",
                      f"{pm.inset_factor_for(closest):.1f}x")
    console.print(table)


@app.command()
def scale(width_m: float = typer.Option(3.0)) -> None:
    """The printed map's arithmetic, which bounds the whole data model."""
    pm = PrintedMap(width_m)
    table = Table(header_style="bold")
    table.add_column("quantity")
    table.add_column("value", justify="right")
    for label, value in (
        ("map area", f"{pm.width_m:.2f} x {pm.height_m:.2f} m"),
        ("scale", f"1 : {pm.scale_denominator/1e6:.1f}M"),
        ("ground per mm", f"{pm.km_per_mm:.1f} km"),
        ("minimum hole spacing", f"{pm.min_place_separation_km:.0f} km"),
        ("minimum tile extent", f"{pm.min_tile_extent_km:.0f} km"),
        ("hole budget", str(PARAMS.hole_budget)),
    ):
        table.add_row(label, value)
    console.print(table)


def _summary(result) -> None:
    s = result.stats
    console.print(f"\n[bold]{s['places_in_app']}[/] places in the app, "
                  f"[bold]{s['places_on_printed_map']}[/] of "
                  f"{s['hole_budget']} holes used, {s['countries']} countries")
    console.print(f"[dim]{s['absorbed']} sites absorbed, "
                  f"{s['retained_sites']} retained as their own places[/]")


if __name__ == "__main__":
    app()
