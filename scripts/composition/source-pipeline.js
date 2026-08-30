import { runAllSources, runSource, runSources } from "../application/source-monitoring.js";
import { monitoringComposition } from "./monitoring-composition.js";

export async function runSourcePipeline({ root, sourceId, source: configuredSource, fetchImpl, now = () => new Date(), dryRun = false }) {
  return runSource({ root, sourceId, source: configuredSource, fetchImpl, now, dryRun, ports: monitoringComposition().ports });
}

export async function runAutomatedSources({ root, fetchImpl, now = () => new Date(), dryRun = false }) {
  return runAllSources({ root, fetchImpl, now, dryRun, ports: monitoringComposition().ports });
}

export async function runConfiguredSources({ root, sources, fetchImpl, now = () => new Date(), dryRun = false }) {
  return runSources({ root, sources, fetchImpl, now, dryRun, ports: monitoringComposition().ports });
}
