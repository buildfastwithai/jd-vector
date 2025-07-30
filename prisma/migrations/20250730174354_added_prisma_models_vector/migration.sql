-- CreateTable
CREATE TABLE "public"."Skill" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Skill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Question" (
    "id" SERIAL NOT NULL,
    "skillId" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "embedding" JSONB NOT NULL,

    CONSTRAINT "Question_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Skill_name_key" ON "public"."Skill"("name");

-- AddForeignKey
ALTER TABLE "public"."Question" ADD CONSTRAINT "Question_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "public"."Skill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
