import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

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

    // Get job description with analysis status and results
    const jobDescription = await prisma.jobDescription.findUnique({
      where: { id: jobDescriptionId },
      include: {
        analysis: true,
        skills: {
          include: {
            skill: true,
            questions: {
              include: {
                question: true,
              },
            },
          },
        },
      },
    });

    if (!jobDescription) {
      return NextResponse.json(
        { error: "Job description not found" },
        { status: 404 }
      );
    }

    // If analysis is completed, return the results
    if (jobDescription.status === "COMPLETED" && jobDescription.analysis) {
      const skills = jobDescription.skills.map((jdSkill) => {
        const questions = jdSkill.questions.map((sq) => ({
          text: sq.question.text,
          confidence: sq.confidence,
          source: sq.source,
        }));

        // Count questions by source
        const existingCount = questions.filter(
          (q) => q.source === "existing"
        ).length;
        const similarCount = questions.filter(
          (q) => q.source === "similar"
        ).length;
        const generatedCount = questions.filter(
          (q) => q.source === "generated"
        ).length;

        return {
          id: jdSkill.skill.id,
          name: jdSkill.skill.name,
          confidence: jdSkill.confidence,
          source: jdSkill.source,
          questions,
          existingCount,
          similarCount,
          generatedCount,
        };
      });

      const response = {
        source: jobDescription.analysis.source,
        message: jobDescription.analysis.message,
        skills,
        similarJDs: jobDescription.analysis.similarJDs
          ? JSON.parse(jobDescription.analysis.similarJDs as string)
          : null,
        jobDescriptionId: jobDescription.id,
      };

      return NextResponse.json(response);
    }

    // Return status information
    return NextResponse.json({
      status: jobDescription.status,
      progress: {
        skillsAnalyzed: jobDescription.skillsAnalyzed,
        totalSkills: jobDescription.totalSkills,
        percentage:
          jobDescription.totalSkills > 0
            ? Math.round(
                (jobDescription.skillsAnalyzed / jobDescription.totalSkills) *
                  100
              )
            : 0,
      },
      message: getStatusMessage(
        jobDescription.status,
        jobDescription.skillsAnalyzed,
        jobDescription.totalSkills
      ),
    });
  } catch (error) {
    console.error("Error getting analysis status:", error);
    return NextResponse.json(
      { error: "Failed to get analysis status" },
      { status: 500 }
    );
  }
}

function getStatusMessage(
  status: string,
  analyzed: number,
  total: number
): string {
  switch (status) {
    case "PENDING":
      return "Analysis is queued and will start shortly";
    case "IN_PROGRESS":
      return `Analyzing skills: ${analyzed} of ${total} completed`;
    case "COMPLETED":
      return "Analysis completed successfully";
    case "FAILED":
      return "Analysis failed. Please try again.";
    default:
      return "Unknown status";
  }
}
