import { monitoringComposition } from "../composition/monitoring-composition.js";

export function getSourceAdapter(name) {
  return { normalize: monitoringComposition().registries.sourceNormalizers.get(name) };
}
