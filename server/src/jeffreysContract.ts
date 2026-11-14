export type StatisticalActionCategory = 'AUTH' | 'ORDER' | 'ADMIN_DENIED' | 'PRODUCT_ADMIN' | 'OTHER';

export type StatisticalDetectorStatus = 'DISABLED' | 'NOT_INTEGRATED' | 'INSUFFICIENT_DATA' | 'AVAILABLE';
export type StatisticalCalibrationStatus = 'NOT_RUN' | 'INSUFFICIENT_DATA' | 'CALIBRATED';

export interface StatisticalAnomalySnapshot {
  detector: 'JEFFREYS_DIVERGENCE';
  experimental: true;
  operational: false;
  detector_status: StatisticalDetectorStatus;
  calibration_status: StatisticalCalibrationStatus;
  calibration_sufficient: boolean;
  divergence: number | null;
  baseline: { sample_count: number | null; distribution: Record<StatisticalActionCategory, number> | null };
  current: { sample_count: number | null; distribution: Record<StatisticalActionCategory, number> | null };
  category_contributions: Record<StatisticalActionCategory, number> | null;
  evaluated_at: string | null;
}

/** Contract-only status. It deliberately does not run the offline detector. */
export function createStatisticalAnomalySnapshot(enabled: boolean): StatisticalAnomalySnapshot {
  return {
    detector: 'JEFFREYS_DIVERGENCE',
    experimental: true,
    operational: false,
    detector_status: enabled ? 'NOT_INTEGRATED' : 'DISABLED',
    calibration_status: 'NOT_RUN',
    calibration_sufficient: false,
    divergence: null,
    baseline: { sample_count: null, distribution: null },
    current: { sample_count: null, distribution: null },
    category_contributions: null,
    evaluated_at: null,
  };
}
