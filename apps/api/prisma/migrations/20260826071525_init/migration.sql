-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('QUEUED', 'CLONING', 'ANALYZING', 'SCANNING', 'EXPLAINING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "repositories" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "defaultBranch" TEXT NOT NULL DEFAULT 'main',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "repositories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analysis_runs" (
    "id" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "status" "RunStatus" NOT NULL DEFAULT 'QUEUED',
    "stage" TEXT,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "commitSha" TEXT,
    "filesAnalyzed" INTEGER,
    "filesDiscovered" INTEGER,
    "truncated" BOOLEAN NOT NULL DEFAULT false,
    "securityScore" DOUBLE PRECISION,
    "bugPronenessScore" DOUBLE PRECISION,
    "scanOutcomes" JSONB NOT NULL DEFAULT '[]',
    "shareSlug" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "analysis_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "file_metrics" (
    "id" TEXT NOT NULL,
    "analysisRunId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "loc" INTEGER NOT NULL DEFAULT 0,
    "churnCommits" INTEGER NOT NULL DEFAULT 0,
    "churnLinesChanged" INTEGER NOT NULL DEFAULT 0,
    "bugCommits" INTEGER NOT NULL DEFAULT 0,
    "cyclomaticComplexity" INTEGER NOT NULL DEFAULT 0,
    "maxNestingDepth" INTEGER NOT NULL DEFAULT 0,
    "churnScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "bugScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "complexityScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "bugPronenessScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "securityScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "securityFindings" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "file_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_explanations" (
    "id" TEXT NOT NULL,
    "fileMetricId" TEXT NOT NULL,
    "cacheKey" TEXT NOT NULL,
    "summaryEn" TEXT NOT NULL,
    "summaryHe" TEXT NOT NULL,
    "recommendationEn" TEXT NOT NULL,
    "recommendationHe" TEXT NOT NULL,
    "primaryRiskFactor" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_explanations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vulnerability_cache" (
    "id" TEXT NOT NULL,
    "osvId" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "cvss" DOUBLE PRECISION,
    "summary" TEXT NOT NULL,
    "referenceUrl" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vulnerability_cache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "repositories_url_key" ON "repositories"("url");

-- CreateIndex
CREATE INDEX "repositories_owner_name_idx" ON "repositories"("owner", "name");

-- CreateIndex
CREATE UNIQUE INDEX "analysis_runs_shareSlug_key" ON "analysis_runs"("shareSlug");

-- CreateIndex
CREATE INDEX "analysis_runs_repositoryId_startedAt_idx" ON "analysis_runs"("repositoryId", "startedAt" DESC);

-- CreateIndex
CREATE INDEX "analysis_runs_status_idx" ON "analysis_runs"("status");

-- CreateIndex
CREATE INDEX "file_metrics_analysisRunId_bugPronenessScore_idx" ON "file_metrics"("analysisRunId", "bugPronenessScore" DESC);

-- CreateIndex
CREATE INDEX "file_metrics_analysisRunId_securityScore_idx" ON "file_metrics"("analysisRunId", "securityScore" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "file_metrics_analysisRunId_path_key" ON "file_metrics"("analysisRunId", "path");

-- CreateIndex
CREATE UNIQUE INDEX "ai_explanations_fileMetricId_key" ON "ai_explanations"("fileMetricId");

-- CreateIndex
CREATE UNIQUE INDEX "ai_explanations_cacheKey_key" ON "ai_explanations"("cacheKey");

-- CreateIndex
CREATE UNIQUE INDEX "vulnerability_cache_osvId_key" ON "vulnerability_cache"("osvId");

-- CreateIndex
CREATE INDEX "vulnerability_cache_fetchedAt_idx" ON "vulnerability_cache"("fetchedAt");

-- AddForeignKey
ALTER TABLE "analysis_runs" ADD CONSTRAINT "analysis_runs_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_metrics" ADD CONSTRAINT "file_metrics_analysisRunId_fkey" FOREIGN KEY ("analysisRunId") REFERENCES "analysis_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_explanations" ADD CONSTRAINT "ai_explanations_fileMetricId_fkey" FOREIGN KEY ("fileMetricId") REFERENCES "file_metrics"("id") ON DELETE CASCADE ON UPDATE CASCADE;
