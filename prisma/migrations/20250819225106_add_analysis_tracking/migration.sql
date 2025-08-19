-- CreateEnum
CREATE TYPE "public"."AnalysisStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED');

-- AlterTable
ALTER TABLE "public"."JobDescription" ADD COLUMN     "skillsAnalyzed" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "status" "public"."AnalysisStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "totalSkills" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "public"."JobDescriptionSkill" ADD COLUMN     "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
ADD COLUMN     "isProcessed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "questionsCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'extracted';

-- CreateTable
CREATE TABLE "public"."JobDescriptionAnalysis" (
    "id" SERIAL NOT NULL,
    "jobDescriptionId" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "similarJDs" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobDescriptionAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SkillQuestion" (
    "id" SERIAL NOT NULL,
    "jobDescriptionSkillId" INTEGER NOT NULL,
    "questionId" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1.0,

    CONSTRAINT "SkillQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "JobDescriptionAnalysis_jobDescriptionId_key" ON "public"."JobDescriptionAnalysis"("jobDescriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "SkillQuestion_jobDescriptionSkillId_questionId_key" ON "public"."SkillQuestion"("jobDescriptionSkillId", "questionId");

-- AddForeignKey
ALTER TABLE "public"."JobDescriptionAnalysis" ADD CONSTRAINT "JobDescriptionAnalysis_jobDescriptionId_fkey" FOREIGN KEY ("jobDescriptionId") REFERENCES "public"."JobDescription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SkillQuestion" ADD CONSTRAINT "SkillQuestion_jobDescriptionSkillId_fkey" FOREIGN KEY ("jobDescriptionSkillId") REFERENCES "public"."JobDescriptionSkill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SkillQuestion" ADD CONSTRAINT "SkillQuestion_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "public"."Question"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
