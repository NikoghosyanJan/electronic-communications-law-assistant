-- Enable pgvector and create tables for Armenian Law RAG

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TYPE "ChunkType" AS ENUM ('parent', 'child');
CREATE TYPE "EvalRunStatus" AS ENUM ('pending', 'running', 'completed', 'failed');

CREATE TABLE "law_chunks" (
    "id" TEXT NOT NULL,
    "articleNumber" INTEGER NOT NULL,
    "articleTitle" TEXT NOT NULL,
    "chapter" TEXT,
    "parentId" TEXT,
    "chunkType" "ChunkType" NOT NULL,
    "content" TEXT NOT NULL,
    "tokenEstimate" INTEGER NOT NULL DEFAULT 0,
    "embedding" vector(1536),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "law_chunks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "eval_runs" (
    "id" TEXT NOT NULL,
    "status" "EvalRunStatus" NOT NULL DEFAULT 'pending',
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "notes" TEXT,
    "summary" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "eval_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "eval_results" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "lang" TEXT NOT NULL,
    "questionType" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT,
    "citations" JSONB,
    "retrievedArticles" JSONB,
    "goldArticles" JSONB,
    "answerAccuracy" DOUBLE PRECISION,
    "citationAccuracy" DOUBLE PRECISION,
    "hallucinationRate" DOUBLE PRECISION,
    "retrievalRecallAtK" DOUBLE PRECISION,
    "ttftMs" INTEGER,
    "totalMs" INTEGER,
    "promptTokens" INTEGER,
    "completionTokens" INTEGER,
    "costUsd" DOUBLE PRECISION,
    "status" TEXT NOT NULL,
    "errorMessage" TEXT,
    "judgeNotes" TEXT,
    "raw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "eval_results_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "law_chunks_articleNumber_idx" ON "law_chunks"("articleNumber");
CREATE INDEX "law_chunks_chunkType_idx" ON "law_chunks"("chunkType");
CREATE INDEX "law_chunks_parentId_idx" ON "law_chunks"("parentId");
CREATE INDEX "eval_results_runId_idx" ON "eval_results"("runId");
CREATE INDEX "eval_results_provider_idx" ON "eval_results"("provider");
CREATE INDEX "eval_results_questionId_idx" ON "eval_results"("questionId");

CREATE INDEX "law_chunks_embedding_hnsw_idx"
  ON "law_chunks"
  USING hnsw (embedding vector_cosine_ops);

ALTER TABLE "law_chunks"
  ADD CONSTRAINT "law_chunks_parentId_fkey"
  FOREIGN KEY ("parentId") REFERENCES "law_chunks"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "eval_results"
  ADD CONSTRAINT "eval_results_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "eval_runs"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
