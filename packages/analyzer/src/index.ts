export { analyzeRepository, type AnalyzeParams, type AnalyzeOutcome } from './analyze';
export { cloneRepository, cleanupClone, sweepWorkspace, type CloneHandle } from './clone';
export { discoverFiles, type DiscoveryResult } from './discover';
export { collectGitMetrics, isBugFixMessage, type GitMetricsResult } from './git-metrics';
export { createParseProject, measureFile, countCodeLines } from './complexity';
export { percentileRanks, aggregateBugProneness, aggregateSecurity } from './normalize';
export {
  scanSecurity,
  runSemgrep,
  runGitleaks,
  runOsv,
  createMemoryAdvisoryCache,
  type SecurityScanParams,
  type SecurityScanResult,
  type Advisory,
  type AdvisoryCache,
} from './security';
export * from './types';
