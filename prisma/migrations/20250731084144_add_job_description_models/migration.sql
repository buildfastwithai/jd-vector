-- CreateTable
CREATE TABLE "public"."JobDescription" (
    "id" SERIAL NOT NULL,
    "title" TEXT,
    "content" TEXT NOT NULL,
    "embedding" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobDescription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."JobDescriptionSkill" (
    "id" SERIAL NOT NULL,
    "jobDescriptionId" INTEGER NOT NULL,
    "skillId" INTEGER NOT NULL,

    CONSTRAINT "JobDescriptionSkill_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "JobDescriptionSkill_jobDescriptionId_skillId_key" ON "public"."JobDescriptionSkill"("jobDescriptionId", "skillId");

-- AddForeignKey
ALTER TABLE "public"."JobDescriptionSkill" ADD CONSTRAINT "JobDescriptionSkill_jobDescriptionId_fkey" FOREIGN KEY ("jobDescriptionId") REFERENCES "public"."JobDescription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."JobDescriptionSkill" ADD CONSTRAINT "JobDescriptionSkill_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "public"."Skill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
