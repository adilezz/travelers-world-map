# Review of the v1 place database — 1 October 2026

Measured on the published v1 bundle (`webapp/twm-app/public/data`, build `twm-e6d7b2a99993`, 12,050 places, 234 countries) and the raw inputs in `database/data/`. This is the record that led to the v2 documents (1, 6, 7, 8). It is not the product description.

## Root cause

`assets.py::assign_assets` attaches every asset within 60 km to the nearest settlement. `orphans_to_sites` promotes only assets farther than 60 km from any settlement. A World Heritage inscription near any town can therefore never become a place; the town is credited with it. Almost every symptom below follows.

## Findings

| Area | Evidence |
|---|---|
| Landmarks | A 180-landmark test (hand-listed, approximate coordinates) found a place within 10 km for 54 %, 25 km 72 %, 50 km 89 %. Machu Picchu → Quillabamba (37 km); Petra → Ma'an; Delphi → Livadeiá; Wadi Rum → Aqaba; Santorini absent (nearest Delos, 110 km); Torres del Paine → El Calafate (104 km, wrong country); Salar de Uyuni 192 km; Mont-Saint-Michel → Saint-Malo |
| World Heritage | 404 of 1,365 property-state rows (30 %) have no WHS-flagged place within 15 km; 107 (8 %) none within 40 km. Kyoto and Kathmandu carry `whs` = 0 |
| Absorption | Cairo (97 pre-merge) absorbed into Giza (53); Johannesburg into Krugersdorp |
| Ranking | Egypt #1 = Yūsuf aṣ-Ṣiddīq (a Faiyum village); Italy #2 Belluno (90) above Florence (77), Venice (64); Lourdes above Paris; Agra 52 below Bengaluru 72; US top ten includes Sheldon Contiguous, Papillion, Ridgecrest, Blue Ridge |
| Living-culture pillar | 35 % of the weight, unscored in 194 of 234 countries; OSM harvest reached 41 countries, Germany + France + Italy + Japan = 66 % of 312k rows |
| Inputs | 151 cuisine regions in 98 countries; 129 UNESCO-ICH rows located; WDPA 12,291 areas, IUCN I–IV only, ≥ 25 km²; no Ramsar or geopark file though the tier exists; geothermal harvest empty; 12,564 of 26,007 candidates have no landform; Wikidata heritage CSV has no labels |
| Quantity | 59 countries ≤ 3 places, 94 ≤ 10 (Maldives 1, Vanuatu 1, Luxembourg 2, Seychelles 2, Singapore 2, Bhutan 5, Fiji 5); Belgium 96, Netherlands 113 vs Egypt 63, Morocco 82, Nepal 23; log(area) vs log(count) r = 0.85; 1,527 places (12.7 %) carry only settlement provenance |
| Kinds | `wildlife` on 54 % of places incl. 4,837 non-sites; `capital` on 12 % (Germany 85 / 241, Poland 48 / 113, Russia 126); 35 % of places have a single kind; Kathmandu lacks old-town and sacred; Marrakesh lacks old-town; 24 landlocked-country places tagged coastal |
| Names | 169 > 40 characters; ~375 WDPA/UNESCO-style names; 16 raw QIDs as names; mojibake (`A\x81reas`); HTML in WHS titles; transliteration-standard names; no `name_local`, no aliases; 67 duplicate (country, name) pairs |
| Identity | Prefix collisions (CHI = China/Chile, MAR = Martinique/Marshall Islands, IND = India/Indonesia); suffixes embed GeoNames `c#`, GHSL `uc#`, WDPA `pa#` and pipeline-stage artefacts (`ewhsn`, `itewhsn`); no QID, OSM id or Wikipedia link stored |
| Stores | DuckDB 15,770 places vs bundle 12,050; no assets table; provenance is a list of source names, not records |
| Spec vs build | Pillar scores, `name_local`, `best_months`, `reach` not exported; lodging, over-tourism and access rules not implemented; recall rule and bias audit have no code; `verify.py` reported 2 FAILs (holes as close as 24.9 km in Belgium) |
| Countries | 235 "countries" include uninhabited territories (Bouvet, Heard Island, Antarctica); `area_km2` null in all published country files; no sovereign flag |

## Caveats

The landmark list was written during the review, not by the owner, with approximate coordinates and a Western, heritage-leaning skew. The 54 % figure is a rough indicator; the individual misses (Machu Picchu, Petra, Santorini, Cairo) are real. The pipeline was not re-run.
