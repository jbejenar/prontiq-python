export function calculateOpenSearchLowFreeStorageThresholdMiB(
  volumeSizeGiB: number,
): number {
  if (!Number.isFinite(volumeSizeGiB) || volumeSizeGiB <= 0) {
    throw new Error("OpenSearch volume size must be a positive finite GiB value.");
  }

  // AWS/ES FreeStorageSpace is published in MiB. For the current alarm we use
  // the per-node Minimum statistic, so the threshold must also be per-node MiB.
  return Math.floor(volumeSizeGiB * 1024 * 0.2);
}
