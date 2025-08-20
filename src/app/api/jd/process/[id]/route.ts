import { getEmbedding } from "@/lib/embedding";
import { openai } from "@/lib/openai";
import { prisma } from "@/lib/prisma";
import {
  searchSimilarJobDescriptions,
  searchSkillsForJobDescription,
} from "@/lib/vectorSearch";
import { NextRequest, NextResponse } from "next/server";

// Helper functions (same as before)
function normalizeSkillName(skillName: string): string {
  return skillName
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function getSkillAliases(skillName: string): string[] {
  const normalized = normalizeSkillName(skillName);
  const aliases = [normalized];

  const mappings: Record<string, string[]> = {
    react: ["reactjs", "react js", "react.js"],
    reactjs: ["react", "react js", "react.js"],
    "react js": ["react", "reactjs", "react.js"],
    "react.js": ["react", "reactjs", "react js"],
    nextjs: ["next js", "next.js", "nextjs", "next"],
    "next js": ["nextjs", "next.js", "next"],
    "next.js": ["nextjs", "next js", "next"],
    next: ["nextjs", "next js", "next.js"],
    nodejs: ["node js", "node.js", "node"],
    "node js": ["nodejs", "node.js", "node"],
    "node.js": ["nodejs", "node js", "node"],
    node: ["nodejs", "node js", "node.js"],
  };

  if (mappings[normalized]) {
    aliases.push(...mappings[normalized]);
  }

  for (const [key, values] of Object.entries(mappings)) {
    if (values.includes(normalized) && !aliases.includes(key)) {
      aliases.push(key);
    }
  }

  return [...new Set(aliases)];
}

function calculateTextSimilarity(str1: string, str2: string): number {
  const norm1 = normalizeSkillName(str1);
  const norm2 = normalizeSkillName(str2);

  if (norm1 === norm2) return 1.0;

  const aliases1 = getSkillAliases(str1);
  const aliases2 = getSkillAliases(str2);

  for (const alias1 of aliases1) {
    for (const alias2 of aliases2) {
      if (alias1 === alias2) return 0.95;
    }
  }

  if (norm1.includes(norm2) || norm2.includes(norm1)) {
    const longer = norm1.length > norm2.length ? norm1 : norm2;
    const shorter = norm1.length > norm2.length ? norm2 : norm1;
    return (shorter.length / longer.length) * 0.9;
  }

  return 0;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const jobDescriptionId = parseInt(id);

    if (isNaN(jobDescriptionId)) {
      return NextResponse.json(
        { error: "Invalid job description ID" },
        { status: 400 }
      );
    }

    // Get the stored job description
    const jobDescription = await prisma.jobDescription.findUnique({
      where: { id: jobDescriptionId },
      include: {
        skills: {
          include: { skill: true },
        },
        analysis: true,
      },
    });

    if (!jobDescription) {
      return NextResponse.json(
        { error: "Job description not found" },
        { status: 404 }
      );
    }

    // Check if already processing or completed
    if (jobDescription.status === "IN_PROGRESS") {
      return NextResponse.json({
        message: "Analysis already in progress",
        status: jobDescription.status,
      });
    }

    if (jobDescription.status === "COMPLETED") {
      return NextResponse.json({
        message: "Analysis already completed",
        status: jobDescription.status,
      });
    }

    // Start the analysis process
    await startAnalysis(
      jobDescriptionId,
      jobDescription.content,
      jobDescription.title
    );

    return NextResponse.json({
      message: "Analysis started successfully",
      status: "IN_PROGRESS",
    });
  } catch (error) {
    console.error("Error starting analysis:", error);
    return NextResponse.json(
      { error: "Failed to start analysis" },
      { status: 500 }
    );
  }
}

async function startAnalysis(
  jobDescriptionId: number,
  content: string,
  title: string | null
) {
  try {
    // Update status to IN_PROGRESS and reset progress
    await prisma.jobDescription.update({
      where: { id: jobDescriptionId },
      data: {
        status: "IN_PROGRESS",
        skillsAnalyzed: 0,
        totalSkills: 0,
      },
    });

    // Check for similar job descriptions
    const similarJDs = await searchSimilarJobDescriptions(content, 3, 0.9);
    let useExistingSkills = false;
    let existingSkills: any[] = [];

    if (similarJDs.length > 0 && similarJDs[0].similarity >= 0.95) {
      // Extract skills from current JD to validate
      const skillsPrompt = `Extract the key technical skills, technologies, and competencies from this job description. Return the response as a JSON object with a "skills" array containing the skill names as strings.

Job Description:
${content}`;

      const skillsCompletion = await openai.chat.completions.create({
        model: "gpt-4.1",
        messages: [{ role: "user", content: skillsPrompt }],
        temperature: 0.3,
        response_format: { type: "json_object" },
      });

      const skillsText = skillsCompletion.choices[0].message.content;
      let extractedSkills: string[] = [];

      try {
        const response = JSON.parse(skillsText || "{}");
        extractedSkills = response.skills || [];
        extractedSkills = extractedSkills
          .filter(
            (skill) => typeof skill === "string" && skill.trim().length > 0
          )
          .map((skill) => skill.trim())
          .slice(0, Math.floor(Math.random() * 3) + 8); // Random between 8-10 skills
      } catch (error) {
        console.error("Failed to parse skills JSON:", error);
        extractedSkills = [];
      }

      // Get skills from similar JD
      const mostSimilarJD = similarJDs[0];
      const jdWithSkills = await prisma.jobDescription.findUnique({
        where: { id: mostSimilarJD.id },
        include: {
          skills: {
            include: { skill: true },
          },
        },
      });

      existingSkills =
        jdWithSkills?.skills.map((jds) => ({
          id: jds.skill.id,
          name: jds.skill.name,
        })) || [];

      // Validate skills match
      let skillsMatch = false;
      if (extractedSkills.length > 0) {
        for (const extractedSkill of extractedSkills) {
          for (const existingSkill of existingSkills) {
            const similarity = calculateTextSimilarity(
              extractedSkill,
              existingSkill.name
            );
            if (similarity >= 0.9) {
              skillsMatch = true;
              break;
            }
          }
          if (skillsMatch) break;
        }
      }

      if (skillsMatch) {
        useExistingSkills = true;
        // Store similar JDs info
        await prisma.jobDescriptionAnalysis.upsert({
          where: { jobDescriptionId },
          update: {
            source: "similar_jd",
            message: `Found similar job description (${(
              similarJDs[0].similarity * 100
            ).toFixed(1)}% match). Using existing skills.`,
            similarJDs: JSON.stringify(
              similarJDs.map((jd) => ({
                id: jd.id,
                title: jd.title,
                similarity: jd.similarity,
                content: jd.content.substring(0, 200) + "...",
              }))
            ),
          },
          create: {
            jobDescriptionId,
            source: "similar_jd",
            message: `Found similar job description (${(
              similarJDs[0].similarity * 100
            ).toFixed(1)}% match). Using existing skills.`,
            similarJDs: JSON.stringify(
              similarJDs.map((jd) => ({
                id: jd.id,
                title: jd.title,
                similarity: jd.similarity,
                content: jd.content.substring(0, 200) + "...",
              }))
            ),
          },
        });
      }
    }

    let skillsToProcess: any[] = [];

    if (useExistingSkills) {
      // Use existing skills from similar JD
      skillsToProcess = existingSkills;

      // Create skill relationships
      for (const skill of existingSkills) {
        await prisma.jobDescriptionSkill.upsert({
          where: {
            jobDescriptionId_skillId: {
              jobDescriptionId,
              skillId: skill.id,
            },
          },
          update: {
            confidence: 1.0,
            source: "existing",
            isProcessed: false, // Reset processing status
          },
          create: {
            jobDescriptionId,
            skillId: skill.id,
            confidence: 1.0,
            source: "existing",
          },
        });
      }
    } else {
      // Extract skills using AI
      const skillsPrompt = `Extract the key technical skills, technologies, and competencies from this job description. Return the response as a JSON object with a "skills" array containing the skill names as strings.

Job Description:
${content}`;

      const skillsCompletion = await openai.chat.completions.create({
        model: "gpt-4.1",
        messages: [{ role: "user", content: skillsPrompt }],
        temperature: 0.3,
        response_format: { type: "json_object" },
      });

      const skillsText = skillsCompletion.choices[0].message.content;
      let extractedSkills: string[] = [];

      try {
        const response = JSON.parse(skillsText || "{}");
        extractedSkills = response.skills || [];
        extractedSkills = extractedSkills
          .filter(
            (skill) => typeof skill === "string" && skill.trim().length > 0
          )
          .map((skill) => skill.trim())
          .slice(0, Math.floor(Math.random() * 3) + 8); // Random between 8-10 skills
      } catch (error) {
        console.error("Failed to parse skills JSON:", error);
        extractedSkills =
          skillsText
            ?.split("\n")
            .filter((line) => line.trim())
            .map((line) => line.replace(/[^a-zA-Z0-9\s\+\#\.\-]/g, "").trim())
            .filter((skill) => skill.length > 0 && skill.length < 50)
            .slice(0, Math.floor(Math.random() * 3) + 8) || []; // Random between 8-10 skills
      }

      // Process skills with confidence scores
      const skillsWithConfidence = await searchSkillsForJobDescription(
        content,
        extractedSkills
      );

      // Create skill relationships
      for (const skillWithConf of skillsWithConfidence) {
        await prisma.jobDescriptionSkill.upsert({
          where: {
            jobDescriptionId_skillId: {
              jobDescriptionId,
              skillId: skillWithConf.id,
            },
          },
          update: {
            confidence: skillWithConf.confidence,
            source: skillWithConf.source,
            isProcessed: false, // Reset processing status
          },
          create: {
            jobDescriptionId,
            skillId: skillWithConf.id,
            confidence: skillWithConf.confidence,
            source: skillWithConf.source,
          },
        });
      }

      skillsToProcess = skillsWithConfidence;

      // Store analysis info
      await prisma.jobDescriptionAnalysis.upsert({
        where: { jobDescriptionId },
        update: {
          source: "extracted",
          message: `Extracted ${extractedSkills.length} skills from job description and processed questions.`,
        },
        create: {
          jobDescriptionId,
          source: "extracted",
          message: `Extracted ${extractedSkills.length} skills from job description and processed questions.`,
        },
      });
    }

    // Update total skills count
    await prisma.jobDescription.update({
      where: { id: jobDescriptionId },
      data: { totalSkills: skillsToProcess.length },
    });

    // Clear existing skill questions if re-analyzing
    await prisma.skillQuestion.deleteMany({
      where: {
        jobDescriptionSkill: {
          jobDescriptionId,
        },
      },
    });

    // Process skills one by one (in background)
    processSkillsSequentially(jobDescriptionId, skillsToProcess);

    return { success: true };
  } catch (error) {
    console.error("Error in analysis:", error);

    // Mark as failed
    await prisma.jobDescription.update({
      where: { id: jobDescriptionId },
      data: { status: "FAILED" },
    });

    throw error;
  }
}

async function processSkillsSequentially(
  jobDescriptionId: number,
  skills: any[]
) {
  for (let i = 0; i < skills.length; i++) {
    try {
      await processSkillQuestions(jobDescriptionId, skills[i]);

      // Update progress
      await prisma.jobDescription.update({
        where: { id: jobDescriptionId },
        data: { skillsAnalyzed: i + 1 },
      });

      console.log(
        `Processed skill ${i + 1}/${skills.length}: ${skills[i].name}`
      );
    } catch (error) {
      console.error(`Error processing skill ${skills[i].name}:`, error);
      // Continue with next skill instead of failing completely
    }
  }

  // Mark as completed
  await prisma.jobDescription.update({
    where: { id: jobDescriptionId },
    data: { status: "COMPLETED" },
  });

  console.log(`Analysis completed for job description ${jobDescriptionId}`);
}

async function processSkillQuestions(jobDescriptionId: number, skill: any) {
  // Get the job description skill record
  const jdSkill = await prisma.jobDescriptionSkill.findFirst({
    where: {
      jobDescriptionId,
      skillId: skill.id,
    },
  });

  if (!jdSkill) {
    throw new Error(`JobDescriptionSkill not found for skill ${skill.id}`);
  }

  // Get existing questions for this skill (limit to prevent connection issues)
  const existingQuestions = await prisma.question.findMany({
    where: { skillId: skill.id },
    take: 7, // Limit to prevent memory issues
    orderBy: { id: "asc" },
  });

  const questionsToLink = [...existingQuestions];
  let generatedCount = 0;

  // If we need more questions, generate them
  const targetQuestions = 10;
  const needToGenerate = Math.max(
    0,
    targetQuestions - existingQuestions.length
  );

  if (needToGenerate > 0) {
    const questionsPrompt = `Generate ${needToGenerate} technical interview questions for the skill "${skill.name}". Return the response as a JSON object with a "questions" array containing the questions as strings.`;

    const questionsCompletion = await openai.chat.completions.create({
      model: "gpt-4.1",
      messages: [{ role: "user", content: questionsPrompt }],
      temperature: 0.7,
      response_format: { type: "json_object" },
    });

    let generatedQuestions: string[] = [];
    try {
      const response = JSON.parse(
        questionsCompletion.choices[0].message.content || "{}"
      );
      generatedQuestions = response.questions || [];
    } catch (error) {
      console.error("Failed to parse questions JSON:", error);
      generatedQuestions =
        questionsCompletion.choices[0].message.content
          ?.split("\n")
          .filter((line) => line.trim())
          .map((q) => q.replace(/^\d+\.\s*/, "").trim())
          .filter((q) => q.length > 0) || [];
    }

    // Store new questions
    for (const questionText of generatedQuestions) {
      const questionEmbedding = await getEmbedding(questionText);
      const newQuestion = await prisma.question.create({
        data: {
          text: questionText,
          skillId: skill.id,
          embedding: questionEmbedding,
        },
      });
      questionsToLink.push(newQuestion);
      generatedCount++;
    }
  }

  // Link questions to this job description skill
  for (let i = 0; i < questionsToLink.length; i++) {
    const question = questionsToLink[i];
    let source = "existing";

    if (i >= existingQuestions.length) {
      source = "generated";
    }

    await prisma.skillQuestion.upsert({
      where: {
        jobDescriptionSkillId_questionId: {
          jobDescriptionSkillId: jdSkill.id,
          questionId: question.id,
        },
      },
      update: {
        source,
        confidence: 1.0,
      },
      create: {
        jobDescriptionSkillId: jdSkill.id,
        questionId: question.id,
        source,
        confidence: 1.0,
      },
    });
  }

  // Update question count
  await prisma.jobDescriptionSkill.update({
    where: { id: jdSkill.id },
    data: {
      questionsCount: questionsToLink.length,
      isProcessed: true,
    },
  });
}
