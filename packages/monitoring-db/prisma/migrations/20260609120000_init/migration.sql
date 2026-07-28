-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "incident_kind" AS ENUM ('STALE', 'ERRORING', 'DB_UNREACHABLE', 'OTHER');

-- CreateEnum
CREATE TYPE "outbox_status" AS ENUM ('PENDING', 'SENT');

-- CreateEnum
CREATE TYPE "severity" AS ENUM ('CRITICAL', 'WARNING');

-- CreateTable
CREATE TABLE "health_event" (
    "id" BIGSERIAL NOT NULL,
    "service" TEXT NOT NULL,
    "env" TEXT NOT NULL,
    "kind" "incident_kind" NOT NULL,
    "severity" "severity" NOT NULL DEFAULT 'WARNING',
    "detail" JSONB NOT NULL,
    "detected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "health_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monitoring_outbox" (
    "id" BIGSERIAL NOT NULL,
    "health_event_id" BIGINT NOT NULL,
    "service" TEXT NOT NULL,
    "env" TEXT NOT NULL,
    "severity" "severity" NOT NULL DEFAULT 'WARNING',
    "subject" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "status" "outbox_status" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMP(3),

    CONSTRAINT "monitoring_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "health_event_service_detected_at_idx" ON "health_event"("service", "detected_at");

-- CreateIndex
CREATE INDEX "monitoring_outbox_status_created_at_idx" ON "monitoring_outbox"("status", "created_at");

-- AddForeignKey
ALTER TABLE "monitoring_outbox" ADD CONSTRAINT "monitoring_outbox_health_event_id_fkey" FOREIGN KEY ("health_event_id") REFERENCES "health_event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
