-- CreateTable
CREATE TABLE "IntegrationError" (
    "id" SERIAL NOT NULL,
    "source" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "context" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "IntegrationError_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IntegrationError_resolvedAt_createdAt_idx" ON "IntegrationError"("resolvedAt", "createdAt");
