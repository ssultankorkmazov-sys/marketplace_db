# Jeffreys Divergence: research summary

**Status: EXPERIMENTAL — NOT INTEGRATED.** The statistical method is not connected to the anomaly worker, does not create incidents, and does not affect risk score, severity, or existing rule-based detectors. `JEFFREYS_DETECTOR_ENABLED` defaults to `false`; setting it to `true` still reports `NOT_INTEGRATED`. No production threshold is selected.

## Method

The pure TypeScript module compares smoothed categorical distributions using

`J(P,Q) = Σᵢ (pᵢ − qᵢ) ln(pᵢ/qᵢ)`

with additive smoothing `alpha = 0.5`. The current grouping maps audit actions to `AUTH`, `ORDER`, `ADMIN_DENIED`, `PRODUCT_ADMIN`, and `OTHER`; unknown actions remain in `OTHER`. Grouping research also compares detailed authentication categories and action-level categories selected using calibration-period frequency. The calculation is deterministic; the research replay constructs each baseline from earlier events and chooses candidate quantiles from calibration only.

## Synthetic experiments

The committed synthetic reports are explicitly labeled `SYNTHETIC` and contain no production data:

- [Grouping comparison, version 3](jeffreys-grouping-comparison-results-v3.json): three original deterministic seeds, shared event sequences across groupings, 70/30 chronological calibration/holdout, injected scenarios in holdout, and non-overlapping current windows. At the 30-day baseline / 6-hour current window / 30-10 minimum configuration, grouping A's pooled calibration P95 was approximately 0.534, with a per-seed range of approximately 0.397–0.634. On the synthetic holdout it recorded TP=82, FP=7, TN=112, FN=99 (precision 0.921, recall 0.453, F1 0.607, FPR 0.059). These are descriptive outcomes for this generator only; windows from the same synthetic user can remain correlated.
- [Independent validation](jeffreys-independent-validation-results.json): four new seeds (4319, 7919, 12077, 20261114), three activity-intensity settings, the same chronological separation, and benign plus injected holdout scenarios. It broadens generator coverage but still uses one synthetic generator design.
- [Synthetic replay study](jeffreys-replay-results.json): controlled stationary, shifted, sparse, irregular, gradual-change, and administrative-denial activity scenarios. It is labeled `synthetic_only`.

Synthetic thresholds and metrics are not production calibration, guarantees, or evidence of malicious activity. Synthetic benign bursts also demonstrate that a score exceedance can be a false signal in a controlled scenario. Consult each report for its exact configurations, scenario metrics, and limitations.

## Historical sample: aggregate findings only

The prior analysis used a user-provided pseudonymized export; the source event file and detailed per-user replay are not included here. The existing analysis recorded 173 events, of which 146 had a pseudonymous user ID and 27 did not; it covered five pseudonymous users and seven active UTC dates within an 18-date calendar span. One user accounted for about 69% of identified events. Export completeness was not independently verified, and there were no ground-truth labels.

At the tested standard minimums (baseline/current 30/10, 50/20, and 100/40), the sample produced zero sufficient calibration windows and zero sufficient holdout windows. An explicitly exploratory 5/1 minimum produced one calibration window and three holdout windows; one holdout score exceeded the single calibration P95 candidate. That is not a valid false-positive estimate or a reliable threshold. No production threshold can be justified from this sample.

## Reproducibility and privacy

The standalone mathematical tests and synthetic study scripts use local deterministic fixtures and do not connect to a database. The safe offline runner accepts only the pseudonymized event schema plus a chronological manifest, refuses input/report paths inside the repository, and refuses to overwrite output. The export SQL is read-only but contains source user IDs in its CSV result; the CSV, pseudonymized event JSON, and detailed per-window reports must remain local and outside Git. The historical calibration report containing detailed pseudonymous behavior is intentionally excluded from publication.

For a demonstration, show the experimental Dashboard panel and explain its `NOT_INTEGRATED` state, then present the formula and the linked synthetic research reports. Do not enable the flag as an operational detector or present synthetic results as production evidence.
