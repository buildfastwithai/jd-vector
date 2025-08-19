import { getEmbedding } from "@/lib/embedding";
import { openai } from "@/lib/openai";
import { prisma } from "@/lib/prisma";
import {
  searchSimilarJobDescriptions,
  searchQuestionsBySkill,
  getQuestionsBySkillId,
  searchSkillsForJobDescription,
  getQuestionsWithConfidence,
  SkillWithConfidence,
  QuestionWithConfidence,
} from "@/lib/vectorSearch";

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

// Progress reporter for streaming updates
class ProgressReporter {
  private encoder = new TextEncoder();
  private controller?: ReadableStreamDefaultController;
  private closed = false;

  constructor(controller?: ReadableStreamDefaultController) {
    this.controller = controller;
  }

  private isControllerReady(): boolean {
    return !!(this.controller && !this.closed);
  }

  report(phase: string, message: string, progress?: number) {
    if (this.isControllerReady()) {
      try {
        const data = {
          phase,
          message,
          progress,
          timestamp: new Date().toISOString(),
        };
        const chunk = this.encoder.encode(`data: ${JSON.stringify(data)}\n\n`);
        this.controller!.enqueue(chunk);
      } catch (error) {
        console.error("Error sending progress update:", error);
        this.closed = true;
      }
    }
    console.log(`[${phase}] ${message}`);
  }

  complete(result: any) {
    if (this.isControllerReady()) {
      try {
        const data = {
          type: "complete",
          result,
          timestamp: new Date().toISOString(),
        };
        const chunk = this.encoder.encode(`data: ${JSON.stringify(data)}\n\n`);
        this.controller!.enqueue(chunk);
        this.controller!.close();
        this.closed = true;
      } catch (error) {
        console.error("Error sending completion:", error);
        this.closed = true;
      }
    }
  }

  error(error: string) {
    if (this.isControllerReady()) {
      try {
        const data = {
          type: "error",
          error,
          timestamp: new Date().toISOString(),
        };
        const chunk = this.encoder.encode(`data: ${JSON.stringify(data)}\n\n`);
        this.controller!.enqueue(chunk);
        this.controller!.close();
        this.closed = true;
      } catch (controllerError) {
        console.error("Error sending error message:", controllerError);
        this.closed = true;
      }
    }
    console.error("Analysis error:", error);
  }
}

export async function GET(req: Request) {
  // For EventSource, we need to return a streaming response
  // The actual job description will be passed via query parameters or we'll use a default flow

  const url = new URL(req.url);
  const jobDescription = url.searchParams.get("jobDescription");
  const title = url.searchParams.get("title");

  if (!jobDescription) {
    return Response.json(
      { error: "Job description is required as query parameter" },
      { status: 400 }
    );
  }

  const stream = new ReadableStream({
    start(controller) {
      const reporter = new ProgressReporter(controller);
      analyzeWithProgress(jobDescription, title, reporter).catch((error) => {
        console.error("Analysis failed:", error);
        const errorMessage =
          error instanceof Error ? error.message : "Analysis failed";
        reporter.error(errorMessage);
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

export async function POST(req: Request) {
  const { jobDescription, title, useSSE } = await req.json();

  if (!jobDescription) {
    return Response.json(
      { error: "Job description is required" },
      { status: 400 }
    );
  }

  // If SSE is requested, return a streaming response
  if (useSSE) {
    const stream = new ReadableStream({
      start(controller) {
        const reporter = new ProgressReporter(controller);
        analyzeWithProgress(jobDescription, title, reporter).catch((error) => {
          console.error("Analysis failed:", error);
          const errorMessage =
            error instanceof Error ? error.message : "Analysis failed";
          reporter.error(errorMessage);
        });
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  }

  // Fallback to regular JSON response
  try {
    const result = await analyzeWithProgress(
      jobDescription,
      title,
      new ProgressReporter()
    );
    return Response.json(result);
  } catch (error) {
    console.error("Error analyzing job description:", error);
    return Response.json(
      { error: "Failed to analyze job description" },
      { status: 500 }
    );
  }
}

async function analyzeWithProgress(
  jobDescription: string,
  title: string | null,
  reporter: ProgressReporter
) {
  try {
    reporter.report("starting", "Starting job description analysis...");

    // 1. Generate embedding for the job description
    reporter.report(
      "jd_embedding",
      "Creating embeddings for job description..."
    );
    const jdEmbedding = await getEmbedding(jobDescription);

    // 2. Search for similar job descriptions
    reporter.report(
      "similar_search",
      "Searching for similar job descriptions..."
    );
    const similarJDs = await searchSimilarJobDescriptions(
      jobDescription,
      3,
      0.9
    );

    if (similarJDs.length > 0 && similarJDs[0].similarity >= 0.95) {
      console.log(
        `Found ${
          similarJDs.length
        } similar job descriptions with highest similarity: ${(
          similarJDs[0].similarity * 100
        ).toFixed(1)}%`
      );

      // First, extract skills from the current JD to validate
      reporter.report("skill_extraction", "Extracting skills using AI...");
      const skillsPrompt = `Extract the key technical skills, technologies, and competencies from this job description. Return the response as a JSON object with a "skills" array containing the skill names as strings.

Job Description:
${jobDescription}`;

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

      console.log("Extracted skills from new JD:", extractedSkills);

      // Get skills from the most similar JD
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

      // Validate that the extracted skills match the similar JD skills
      reporter.report(
        "skill_matching",
        "Matching extracted skills with existing skills..."
      );
      let skillsMatch = false;
      if (extractedSkills.length > 0) {
        for (const extractedSkill of extractedSkills) {
          for (const existingSkill of existingSkills) {
            // Use our enhanced text similarity for validation
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

      console.log("Skills match validation:", skillsMatch);

      if (!skillsMatch && extractedSkills.length > 0) {
        console.log(
          "Skills don't match similar JD. Treating as new JD to ensure accurate skill extraction."
        );
        // Fall through to the normal extraction logic
      } else {
        // Skills match! Use the similar JD's skills
        console.log("Skills match! Using existing skills from similar JD.");

        // Get questions with confidence scores for each skill (10 questions per skill)
        reporter.report(
          "question_search",
          "Finding existing interview questions..."
        );
        const skillsWithQuestions = await Promise.all(
          existingSkills.map(async (skill) => {
            // Get 10 questions using the enhanced vector search
            const questionsWithConfidence = await getQuestionsWithConfidence(
              skill.name,
              skill.id,
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
              reporter.report(
                "question_generation",
                `Generating ${lowConfidenceQuestions.length} new questions for ${skill.name}...`
              );
              console.log(
                `Generating ${lowConfidenceQuestions.length} new questions for ${skill.name}`
              );

              const questionsPrompt = `Generate ${lowConfidenceQuestions.length} technical interview questions for the skill "${skill.name}". Return the response as a JSON object with a "questions" array containing the questions as strings.`;

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
                    skillId: skill.id,
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

            console.log(
              `${skill.name}: ${existingCount} existing + ${similarCount} similar + ${generatedCount} generated = ${processedQuestions.length} total questions`
            );

            return {
              id: skill.id,
              name: skill.name,
              confidence: 1.0, // Existing skills from similar JD have high confidence
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

        reporter.report("finalizing", "Preparing final results...");
        const result = {
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
        };

        reporter.complete(result);
        return result;
      }
    }

    // 3. No similar JD found or similarity too low, extract skills using OpenAI
    if (similarJDs.length > 0) {
      console.log(
        `Similar JDs found but highest similarity is ${(
          similarJDs[0].similarity * 100
        ).toFixed(
          1
        )}% (below 98% threshold). Treating as new JD to ensure accurate skill extraction.`
      );
    } else {
      console.log(
        "No similar job descriptions found. Extracting skills from JD."
      );
    }

    reporter.report("skill_extraction", "Extracting skills using AI...");
    const skillsPrompt = `Extract the key technical skills, technologies, and competencies from this job description. Return the response as a JSON object with a "skills" array containing the skill names as strings.

Job Description:
${jobDescription}`;

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

      // Ensure it's an array of strings
      if (!Array.isArray(extractedSkills)) {
        throw new Error("Response is not an array");
      }

      // Clean and filter skills
      extractedSkills = extractedSkills
        .filter((skill) => typeof skill === "string" && skill.trim().length > 0)
        .map((skill) => skill.trim())
        .slice(0, 15); // Limit to 15 skills max
    } catch (error) {
      console.error("Failed to parse skills JSON:", error);
      console.log("Raw OpenAI response:", skillsText);

      // Fallback: try to extract skills from text
      extractedSkills =
        skillsText
          ?.split("\n")
          .filter((line) => line.trim())
          .map((line) => line.replace(/[^a-zA-Z0-9\s\+\#\.\-]/g, "").trim())
          .filter((skill) => skill.length > 0 && skill.length < 50) // Remove very long lines
          .slice(0, 10) || [];
    }

    console.log("Extracted skills:", extractedSkills);

    // 4. Store the job description
    const savedJD = await prisma.jobDescription.create({
      data: {
        title: title || null,
        content: jobDescription,
        embedding: jdEmbedding,
      },
    });

    // 5. Process skills with confidence scores
    reporter.report(
      "skill_matching",
      "Matching skills with existing database..."
    );
    const skillsWithConfidence = await searchSkillsForJobDescription(
      jobDescription,
      extractedSkills
    );

    // Link skills to job description and get questions (10 questions per skill)
    reporter.report(
      "question_search",
      "Finding existing interview questions..."
    );
    const skillsWithQuestions = await Promise.all(
      skillsWithConfidence.map(async (skillWithConf) => {
        // Link skill to job description
        await prisma.jobDescriptionSkill.create({
          data: {
            jobDescriptionId: savedJD.id,
            skillId: skillWithConf.id,
          },
        });

        // Get 10 questions using the enhanced vector search
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
          console.log(
            `Generating ${lowConfidenceQuestions.length} new questions for ${skillWithConf.name}`
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

        console.log(
          `${skillWithConf.name}: ${existingCount} existing + ${similarCount} similar + ${generatedCount} generated = ${processedQuestions.length} total questions`
        );

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

    reporter.report("finalizing", "Preparing final results...");
    const result = {
      source: "extracted",
      jobDescriptionId: savedJD.id,
      skills: skillsWithQuestions,
      message: `Extracted ${extractedSkills.length} skills from job description and processed questions.`,
    };

    reporter.complete(result);
    return result;
  } catch (error) {
    console.error("Error analyzing job description:", error);
    const errorMessage =
      error instanceof Error
        ? error.message
        : "Failed to analyze job description";
    reporter.error(errorMessage);
    throw error;
  }
}
