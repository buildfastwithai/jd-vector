-- CreateTable
CREATE TABLE "public"."SkillAlias" (
    "id" SERIAL NOT NULL,
    "skillId" INTEGER NOT NULL,
    "alias" TEXT NOT NULL,

    CONSTRAINT "SkillAlias_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SkillAlias_alias_idx" ON "public"."SkillAlias"("alias");

-- CreateIndex
CREATE UNIQUE INDEX "SkillAlias_skillId_alias_key" ON "public"."SkillAlias"("skillId", "alias");

-- AddForeignKey
ALTER TABLE "public"."SkillAlias" ADD CONSTRAINT "SkillAlias_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "public"."Skill"("id") ON DELETE CASCADE ON UPDATE CASCADE;
