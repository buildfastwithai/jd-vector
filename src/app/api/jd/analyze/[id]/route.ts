import { openai } from "@/lib/openai";
import { prisma } from "@/lib/prisma";
import { getEmbedding } from "@/lib/embedding";
import {
  searchSimilarJobDescriptions,
  searchQuestionsBySkill,
  getQuestionsBySkillId,
  searchSkillsForJobDescription,
  getQuestionsWithConfidence,
  SkillWithConfidence,
  QuestionWithConfidence,
} from "@/lib/vectorSearch";
import { NextRequest, NextResponse } from "next/server";

// Import helper function for skill validation
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

export async function GET(
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
    });

    if (!jobDescription) {
      return NextResponse.json(
        { error: "Job description not found" },
        { status: 404 }
      );
    }

    // Check if this JD already has skills (was analyzed before)
    const existingSkills = await prisma.jobDescriptionSkill.findMany({
      where: { jobDescriptionId },
      include: { skill: true },
    });

    if (existingSkills.length > 0) {
      // JD was already analyzed, return existing results
      const skillsWithQuestions = await Promise.all(
        existingSkills.map(async (jds) => {
          const questionsWithConfidence = await getQuestionsWithConfidence(
            jds.skill.name,
            jds.skill.id,
            10
          );

          const existingCount = questionsWithConfidence.filter(
            (q) => q.source === "existing"
          ).length;
          const similarCount = questionsWithConfidence.filter(
            (q) => q.source === "similar"
          ).length;
          const generatedCount = questionsWithConfidence.filter(
            (q) => q.source === "generated"
          ).length;

          return {
            id: jds.skill.id,
            name: jds.skill.name,
            confidence: 1.0,
            questions: questionsWithConfidence.map((q) => ({
              text: q.text,
              confidence: q.similarity,
              source: q.source,
            })),
            existingCount,
            similarCount,
            generatedCount,
          };
        })
      );

      return NextResponse.json({
        source: "existing",
        jobDescriptionId: jobDescription.id,
        skills: skillsWithQuestions,
        message: "Using existing analysis results",
      });
    }

    // Search for similar job descriptions
    const similarJDs = await searchSimilarJobDescriptions(
      jobDescription.content,
      3,
      0.9
    );

    if (similarJDs.length > 0 && similarJDs[0].similarity >= 0.95) {
      // Found similar JD, use its skills
      const mostSimilarJD = similarJDs[0];
      const jdWithSkills = await prisma.jobDescription.findUnique({
        where: { id: mostSimilarJD.id },
        include: {
          skills: {
            include: {
              skill: true,
            },
          },
        },
      });

      const existingSkills =
        jdWithSkills?.skills.map((jds) => ({
          id: jds.skill.id,
          name: jds.skill.name,
        })) || [];

      // Extract skills from current JD to validate
      const skillsPrompt = `Extract the key technical skills, technologies, and competencies from this job description. Return the response as a JSON object with a "skills" array containing the skill names as strings.

Job Description:
${jobDescription.content}`;

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
          .slice(0, 15);
      } catch (error) {
        console.error("Failed to parse skills JSON:", error);
        extractedSkills = [];
      }

      // Validate skills match
      let skillsMatch = false;
      if (extractedSkills.length > 0) {
        for (const extractedSkill of extractedSkills) {
          for (const existingSkill of existingSkills) {
            const similarity = await calculateTextSimilarity(
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
        // Use similar JD skills
        const skillsWithQuestions = await Promise.all(
          existingSkills.map(async (skill) => {
            const questionsWithConfidence = await getQuestionsWithConfidence(
              skill.name,
              skill.id,
              10
            );

            const existingCount = questionsWithConfidence.filter(
              (q) => q.source === "existing"
            ).length;
            const similarCount = questionsWithConfidence.filter(
              (q) => q.source === "similar"
            ).length;
            const generatedCount = questionsWithConfidence.filter(
              (q) => q.source === "generated"
            ).length;

            // Link skill to current JD
            await prisma.jobDescriptionSkill.create({
              data: {
                jobDescriptionId: jobDescription.id,
                skillId: skill.id,
              },
            });

            return {
              id: skill.id,
              name: skill.name,
              confidence: 1.0,
              questions: questionsWithConfidence.map((q) => ({
                text: q.text,
                confidence: q.similarity,
                source: q.source,
              })),
              existingCount,
              similarCount,
              generatedCount,
            };
          })
        );

        return NextResponse.json({
          source: "similar_jd",
          similarJDs: similarJDs.map((jd) => ({
            id: jd.id,
            title: jd.title,
            similarity: jd.similarity,
            content: jd.content.substring(0, 200) + "...",
          })),
          skills: skillsWithQuestions,
          message: `Found similar job description (${(
            similarJDs[0].similarity * 100
          ).toFixed(1)}% match). Using existing skills.`,
        });
      }
    }

    // No similar JD found or skills don't match, extract skills using AI
    const skillsPrompt = `Extract the key technical skills, technologies, and competencies from this job description. Return the response as a JSON object with a "skills" array containing the skill names as strings.

Job Description:
${jobDescription.content}`;

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
        .filter((skill) => typeof skill === "string" && skill.trim().length > 0)
        .map((skill) => skill.trim())
        .slice(0, 15);
    } catch (error) {
      console.error("Failed to parse skills JSON:", error);
      extractedSkills =
        skillsText
          ?.split("\n")
          .filter((line) => line.trim())
          .map((line) => line.replace(/[^a-zA-Z0-9\s\+\#\.\-]/g, "").trim())
          .filter((skill) => skill.length > 0 && skill.length < 50)
          .slice(0, 10) || [];
    }

    // Process skills with confidence scores
    const skillsWithConfidence = await searchSkillsForJobDescription(
      jobDescription.content,
      extractedSkills
    );

    // Link skills to job description and get questions
    const skillsWithQuestions = await Promise.all(
      skillsWithConfidence.map(async (skillWithConf) => {
        // Link skill to job description
        await prisma.jobDescriptionSkill.create({
          data: {
            jobDescriptionId: jobDescription.id,
            skillId: skillWithConf.id,
          },
        });

        // Get questions using vector search
        const questionsWithConfidence = await getQuestionsWithConfidence(
          skillWithConf.name,
          skillWithConf.id,
          10
        );

        // Check if we need to generate questions
        const needGeneration = questionsWithConfidence.some(
          (q) => q.needsGeneration
        );

        let processedQuestions = [...questionsWithConfidence];

        if (needGeneration) {
          const lowConfidenceQuestions = questionsWithConfidence.filter(
            (q) => q.needsGeneration
          );

          const questionsPrompt = `Generate ${lowConfidenceQuestions.length} technical interview questions for the skill "${skillWithConf.name}". Return the response as a JSON object with a "questions" array containing the questions as strings.`;

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

          // Store new questions with embeddings
          for (const questionText of generatedQuestions) {
            const questionEmbedding = await getEmbedding(questionText);
            await prisma.question.create({
              data: {
                text: questionText,
                skillId: skillWithConf.id,
                embedding: questionEmbedding,
              },
            });
          }

          // Replace placeholders with generated questions
          let generatedIndex = 0;
          processedQuestions = questionsWithConfidence.map((q) => {
            if (
              q.needsGeneration &&
              generatedIndex < generatedQuestions.length
            ) {
              const newQuestion = {
                ...q,
                text: generatedQuestions[generatedIndex],
                similarity: 1.0,
                needsGeneration: false,
                source: "generated" as const,
              };
              generatedIndex++;
              return newQuestion;
            }
            return q;
          });
        }

        // Count sources
        const existingCount = processedQuestions.filter(
          (q) => q.source === "existing"
        ).length;
        const similarCount = processedQuestions.filter(
          (q) => q.source === "similar"
        ).length;
        const generatedCount = processedQuestions.filter(
          (q) => q.source === "generated"
        ).length;

        return {
          id: skillWithConf.id,
          name: skillWithConf.name,
          confidence: skillWithConf.confidence,
          source: skillWithConf.source,
          questions: processedQuestions.map((q) => ({
            text: q.text,
            confidence: q.similarity,
            source: q.source,
          })),
          existingCount,
          similarCount,
          generatedCount,
        };
      })
    );

    const result = {
      source: "extracted",
      jobDescriptionId: jobDescription.id,
      skills: skillsWithQuestions,
      message: `Extracted ${extractedSkills.length} skills from job description and processed questions.`,
    };

    return NextResponse.json(result);
  } catch (error) {
    console.error("Error analyzing job description:", error);
    return NextResponse.json(
      { error: "Failed to analyze job description" },
      { status: 500 }
    );
  }
}
