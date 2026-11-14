# Local offline Jeffreys replay

This tool analyzes only a local, already pseudonymized JSON export. It does not read `.env`, connect to PostgreSQL, contact Neon/Render, write incidents, or invoke the production worker. Keep both the event export and generated report outside the repository: action/timestamp sequences remain sensitive behavioral data.

## Input files

The event JSON must be an array in the existing pseudonymized export format. Every row must contain exactly:

```json
{"user_id": 2147483648, "action": "LOGIN_SUCCESS", "created_at": "2026-01-01T10:15:00.000Z", "status": "SUCCESS"}
```

`user_id` must be `null` or a numeric pseudonym above PostgreSQL's positive `INT` range, as produced by `pseudonymize-jeffreys-export.mjs`. The runner rejects extra fields, including IPs, `details`, and labels. It accepts only the output shape of the existing local pseudonymizer; do not give it source CSV or source user IDs.

The separate manifest must contain exactly these fields:

```json
{
  "formatVersion": 1,
  "timezone": "UTC",
  "calibrationStartInclusive": "2026-01-31T00:00:00.000Z",
  "calibrationEndExclusive": "2026-03-01T00:00:00.000Z",
  "holdoutStartInclusive": "2026-03-01T00:00:00.000Z",
  "holdoutEndExclusive": "2026-03-31T00:00:00.000Z",
  "exportedEventCount": 173,
  "sourceDescription": "approved_anonymized_export"
}
```

The dates and count above are illustrative only. Replace them with values verified from the actual export. Fix boundaries before viewing divergence results. Periods must be valid ordered, non-overlapping UTC ranges, and the event count must exactly match the JSON array.

## Run

From the repository root, first build the backend TypeScript modules:

```powershell
npm --prefix server run build
```

Then provide paths to the pseudonymized array, manifest and a new report path, all outside the repository. Example:

```powershell
node .\server\scripts\jeffreys-offline-replay.mjs `
  --input "C:\PrivateData\jeffreys-events.json" `
  --manifest "C:\PrivateData\jeffreys-manifest.json" `
  --output "C:\PrivateData\jeffreys-offline-report.json"
```

The report output must not already exist; the runner refuses to overwrite it and refuses input/report paths inside the repository. Optional settings:

```powershell
  --baseline-days 30 `
  --current-window-hours 24 `
  --evaluation-step-hours 24 `
  --alpha 0.5 `
  --minimum-baseline 50 `
  --minimum-current 20 `
  --quantiles 0.95,0.99
```

These defaults are research configuration, not validated production thresholds. The runner uses the existing five-category mapping, Jeffreys formula and chronological replay. It applies calibration-only quantiles to the later holdout period. Insufficient windows are listed with sample counts and `divergence: null`; they are not scored. `null` user IDs are counted but excluded from per-user replay.

## Interpreting the report

- Calibration and holdout summaries separately show total, sufficient and insufficient windows, exclusions, and divergence distributions from sufficient windows only.
- Window rows use temporary report-local subject labels (`S1`, `S2`, …), not input pseudonyms or source IDs.
- Holdout values above calibration candidates are descriptive exceedances only. The input format has no ground-truth labels, so classification metrics (`false positives`, detection rate, precision, recall) are `null` and are not estimated.
- The JSON Schema and a no-data shape example are in `jeffreys-offline-report.schema.json` and `jeffreys-offline-report.example.json`.
- Do not choose a production threshold from these outputs alone. Review data coverage, per-user concentration, independent holdout behavior and ground truth with the research report before proposing any integration.

No real-data result is produced by running tests; tests use small deterministic fixtures only.
