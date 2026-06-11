-- CreateTable
CREATE TABLE "ErrorLog" (
    "id" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "route" TEXT,
    "message" TEXT NOT NULL,
    "stack" TEXT,
    "context" JSONB,

    CONSTRAINT "ErrorLog_pkey" PRIMARY KEY ("id")
);
