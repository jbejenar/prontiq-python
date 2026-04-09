/**
 * Scoring and ranking utilities for search results.
 * Used by query builders to normalize scores and apply business logic.
 */

/**
 * Classify an OpenSearch relevance score into a confidence level.
 * Thresholds tuned against G-NAF address data — adjust per product.
 */
export function classifyConfidence(score: number): "high" | "medium" | "low" {
  if (score > 20) return "high";
  if (score > 10) return "medium";
  return "low";
}
