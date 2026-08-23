# Travelers World Map

A first-class world map for travelers: a large printed wall map with magnetic
territory tiles, drilled at the coordinates of every place worth going to, and a
web application built on the same database.

One place database, two renderings of it. The application shows every place; the
printed map shows the subset that fits 3,000 drilled holes with 60 km between
them. Roughly a third of the world's essential places sit within 60 km of another
one, so that separation is what stops the physical constraint deciding what the
database is allowed to contain.

## What is here

| | |
|---|---|
| `docs/1` | **The Place Model** — how a place is chosen, scored and grouped. The approved specification. |
| `docs/2` | **Product specification** — what the web application does, screen by screen. |
| `docs/3` | **Ergonomics and design system** — layout, tokens, components, map interaction, accessibility. |
| `docs/4` | **Technical architecture** — stack, data model, map rendering, integrations, operations. |
| `database/` | The construction pipeline. Python, runnable, tested. Documents itself — see its README. |
| `webapp/` | Source of the working prototype. |
| `archive/` | Superseded drafts and the validation work behind the model. Kept for reasoning, not for reference. |

Read `docs/1` first. Everything else assumes it.

## The idea in one paragraph

A traveler marks the places they have been. The map answers a question no travel
product answers today: not *how many* places you have visited, but *which kinds
of place you have never been to*. Every place carries the archetypes it
represents — living old town, high mountain, desert, sacred site, and eight
others — so a traveler who has been to a country six times can be shown, truly,
that they have never seen one of the things that country is.

## State

The model is approved and implemented. The pipeline runs. A working prototype of
the application exists covering five countries. The printed map is deferred until
the database is proven at wider scale.
