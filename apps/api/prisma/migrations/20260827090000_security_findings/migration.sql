-- AlterTable
ALTER TABLE "analysis_runs" ADD COLUMN     "repositoryFindings" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "vulnerability_cache" ADD COLUMN     "fixedVersions" JSONB NOT NULL DEFAULT '{}';
