# Destination Research Guide

Follow these steps to produce a new destination's seed data. The output is committed as static JSON in `src/data/{city}/`.

## Source tiers (family-friendliness scoring)

| Tier | Weight | Examples |
|------|--------|---------|
| 1 | 3 | Established travel publications — Time Out (local), Lonely Planet, Condé Nast Traveler |
| 2 | 2 | Local/family-specific — [city] with Kids, Japan Times family content, local parenting blogs |
| 3 | 1 | Community consensus — Reddit r/[cityTravel] family threads (WG `reddit-quotes`), high-view YouTube family travel |

## `familyFriendlinessScore` derivation

For each neighborhood:
1. Count weighted source mentions recommending it for families: `sum(mention_count × tier_weight)`
2. Normalize to 0–100 relative to the highest-scoring neighborhood in the set
3. Record each source in the `sources` array for auditability
4. Ensure all scores are distinct (no ties) — add ±1 where needed for deterministic ranking

## Pipeline steps

1. Query Tier 1–2 sources for "best [city] neighborhoods for families" — collect candidate neighborhoods
2. For each candidate, run `wanderlust-goat-pp-cli reddit-quotes "[neighborhood], [city]"` to surface community consensus
3. Aggregate weighted mention counts per neighborhood → `familyFriendlinessScore`
4. Extract highlight places and food+activity bundles from cross-source mentions (2+ independent mentions required)
5. **Human review pass**: validate accuracy, confirm centroid coordinates, check SafetyArea overlap (no neighborhood centroid should be inside a flagged area), adjust scores where source data is thin
6. Commit finalized JSON

## `dayInTheLifePreview` content rules

- `highlights`: named by 2+ independent sources
- `sampleBundle`: most-cited food option + most-cited activity within walking distance of centroid
- `safetyNote`: references SafetyArea entries if the neighborhood is near a flagged district

## `safety-areas.json` rules

- Entries come from official advisories only (e.g. OSAC, UK FCDO, US State Dept) — no crowdsourced tags
- Every entry must have a `sourceQuote` citing the exact advisory text
- Geometry is district-level (point at district center or rough polygon) — document this granularity in UI warnings

## Adding a new destination

1. Create `src/data/{city}/` with `destination.json`, `neighborhoods.json`, `safety-areas.json`
2. Add one `Destination` seed record (the seed script discovers it automatically)
3. No service code changes required (R6 contract)
