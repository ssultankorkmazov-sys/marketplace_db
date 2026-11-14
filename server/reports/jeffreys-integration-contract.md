# Jeffreys Divergence integration boundary

## Current behavior

The three existing rule detectors remain authoritative and unchanged:

- `REPEATED_FAILED_LOGINS`
- `REPEATED_ADMIN_ACCESS_DENIED`
- `UNUSUAL_ORDER_ACTIVITY`

They continue to use the PostgreSQL audit-event outbox, background worker, existing risk/severity calculation, incident persistence, and administrator realtime notifications.

Jeffreys Divergence remains an isolated research calculation. This stage adds an admin-only status endpoint and an explicitly experimental dashboard panel. It does not read audit history for scoring, subscribe to the outbox, call `processPendingAnomalyEvents`, publish WebSocket events, write incidents, or alter existing risk scores/severity.

## Contract

`GET /api/v1/admin/anomalies/statistical-status` requires the existing valid admin session. It returns:

- detector identity and experimental/non-operational markers;
- detector status (`DISABLED`, `NOT_INTEGRATED`, `INSUFFICIENT_DATA`, `AVAILABLE`);
- calibration status and sufficiency;
- nullable divergence, baseline/current sample counts and distributions, per-category contributions, and evaluation timestamp.

Unavailable measurements are `null`, not zero. The current endpoint returns `DISABLED` by default, or `NOT_INTEGRATED` if the future configuration flag is true; it never returns `AVAILABLE`. `INSUFFICIENT_DATA` is part of the future response contract so the UI can explain sparse windows without presenting them as detections. No production threshold is supplied or implied.

## Future coexistence rules

After real-data validation, any future statistical evaluation should be introduced as a separate module and explicitly approved before enablement. It must preserve the three existing rules and their outputs. Statistical results should remain descriptive until there is a reviewed calibration policy; they must not silently alter `calculateRiskScore`, severity, incident status, or business actions. If a later stage proposes statistical incidents, it must define separate deduplication and evidence semantics and receive its own review. This contract stage creates none.

The feature flag `JEFFREYS_DETECTOR_ENABLED` defaults to `false`. Setting it to `true` only changes the status label to `NOT_INTEGRATED`; it does not activate computation. This deliberately prevents configuration alone from turning an unvalidated detector on.
