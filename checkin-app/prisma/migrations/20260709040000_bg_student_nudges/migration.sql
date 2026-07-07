-- CreateTable
CREATE TABLE "PersonBgNudge" (
    "id" SERIAL NOT NULL,
    "processId" INTEGER NOT NULL,
    "thresholdDay" INTEGER NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PersonBgNudge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PersonBgNudge_processId_thresholdDay_key" ON "PersonBgNudge"("processId", "thresholdDay");

-- AddForeignKey
ALTER TABLE "PersonBgNudge" ADD CONSTRAINT "PersonBgNudge_processId_fkey" FOREIGN KEY ("processId") REFERENCES "OrgMembershipProcess"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
