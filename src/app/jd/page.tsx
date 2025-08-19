"use client";

import { useState } from "react";
import SkillsTable from "@/components/SkillsTable";
import QuestionsTable from "@/components/QuestionsTable";
import { AnalyzeResponse } from "@/types";

interface ThinkingPhase {
  id: string;
  label: string;
  status: "pending" | "active" | "completed";
  description: string;
}

export default function JobDescriptionAnalyzer() {
  const [jobDescription, setJobDescription] = useState("");
  const [title, setTitle] = useState("");
  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState("");
  const [showThinking, setShowThinking] = useState(false);
  const [isThinkingCollapsed, setIsThinkingCollapsed] = useState(true);
  const [expandedSkills, setExpandedSkills] = useState<Set<number>>(new Set());
  const [skillQuestionPages, setSkillQuestionPages] = useState<
    Record<number, number>
  >({});
  const [thinkingPhases, setThinkingPhases] = useState<ThinkingPhase[]>([
    {
      id: "starting",
      label: "🚀 Starting Analysis",
      status: "pending",
      description: "Initializing job description analysis...",
    },
    {
      id: "jd_embedding",
      label: "🧠 Creating JD Embeddings",
      status: "pending",
      description: "Converting job description to vector format...",
    },
    {
      id: "similar_search",
      label: "🔍 Searching Similar Jobs",
      status: "pending",
      description: "Finding similar job descriptions in database...",
    },
    {
      id: "skill_extraction",
      label: "⚡ Extracting Skills",
      status: "pending",
      description: "Using AI to identify technical skills...",
    },
    {
      id: "skill_matching",
      label: "🎯 Matching Skills",
      status: "pending",
      description: "Finding matches in existing skill database...",
    },
    {
      id: "alias_generation",
      label: "🏷️ Generating Aliases",
      status: "pending",
      description: "Creating skill variations and aliases...",
    },
    {
      id: "question_search",
      label: "❓ Finding Questions",
      status: "pending",
      description: "Searching for existing interview questions...",
    },
    {
      id: "question_generation",
      label: "✨ Generating Questions",
      status: "pending",
      description: "Creating new interview questions with AI...",
    },
    {
      id: "finalizing",
      label: "🎉 Finalizing",
      status: "pending",
      description: "Preparing comprehensive analysis results...",
    },
  ]);

  const updatePhaseStatus = (
    phaseId: string,
    status: "pending" | "active" | "completed"
  ) => {
    setThinkingPhases((prev) =>
      prev.map((phase) => (phase.id === phaseId ? { ...phase, status } : phase))
    );
  };

  const connectToProgressStream = () => {
    return new Promise<AnalyzeResponse>((resolve, reject) => {
      // Create EventSource with job description as query parameter
      const params = new URLSearchParams({
        jobDescription: jobDescription.trim(),
        ...(title.trim() && { title: title.trim() }),
      });

      const eventSource = new EventSource(`/api/jd/analyze?${params}`);

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          if (data.type === "complete") {
            eventSource.close();
            resolve(data.result);
          } else if (data.type === "error") {
            eventSource.close();
            reject(new Error(data.error));
          } else if (data.phase) {
            // Update progress
            updatePhaseStatus(data.phase, "active");

            // Mark previous phases as completed
            const phases = [
              "starting",
              "jd_embedding",
              "similar_search",
              "skill_extraction",
              "skill_matching",
              "alias_generation",
              "question_search",
              "question_generation",
              "finalizing",
            ];

            const currentIndex = phases.indexOf(data.phase);
            if (currentIndex > 0) {
              for (let i = 0; i < currentIndex; i++) {
                updatePhaseStatus(phases[i], "completed");
              }
            }
          }
        } catch (e) {
          console.error("Error parsing SSE data:", e);
        }
      };

      eventSource.onerror = (error) => {
        eventSource.close();
        reject(new Error("EventSource error: " + error));
      };
    });
  };

  const resetThinkingPhases = () => {
    setThinkingPhases((prev) =>
      prev.map((phase) => ({ ...phase, status: "pending" as const }))
    );
  };

  const toggleSkillExpansion = (skillId: number) => {
    setExpandedSkills((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(skillId)) {
        newSet.delete(skillId);
      } else {
        newSet.add(skillId);
        // Initialize page to 1 when expanding
        if (!skillQuestionPages[skillId]) {
          setSkillQuestionPages((prev) => ({ ...prev, [skillId]: 1 }));
        }
      }
      return newSet;
    });
  };

  const setSkillPage = (skillId: number, page: number) => {
    setSkillQuestionPages((prev) => ({ ...prev, [skillId]: page }));
  };

  const getSkillQuestions = (
    questions: any[],
    page: number,
    pageSize: number = 5
  ) => {
    const startIndex = (page - 1) * pageSize;
    const endIndex = startIndex + pageSize;
    return questions.slice(startIndex, endIndex);
  };

  const getTotalPages = (totalQuestions: number, pageSize: number = 5) => {
    return Math.ceil(totalQuestions / pageSize);
  };

  const analyzeJD = async () => {
    if (!jobDescription.trim()) {
      setError("Please enter a job description");
      return;
    }

    setIsAnalyzing(true);
    setError("");
    setShowThinking(true);
    resetThinkingPhases();

    try {
      // Use real-time progress streaming
      const data = await connectToProgressStream();
      setResult(data);

      // Mark all phases as completed
      updatePhaseStatus("finalizing", "completed");

      // Small delay to show final completion
      await new Promise((resolve) => setTimeout(resolve, 500));
      setShowThinking(false);
    } catch (error) {
      console.error("Error analyzing job description:", error);
      setError("Failed to analyze job description. Please try again.");
      setShowThinking(false);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const clearForm = () => {
    setJobDescription("");
    setTitle("");
    setResult(null);
    setError("");
    setShowThinking(false);
    setExpandedSkills(new Set());
    setSkillQuestionPages({});
    resetThinkingPhases();
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto p-6">
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Job Description Analyzer
          </h1>
          <p className="text-gray-600 mb-6">
            Analyze job descriptions with AI-powered skill extraction and
            intelligent question generation. Features confidence scoring and
            automatic question generation when similarity is below 90%.
          </p>

          {/* Input Form */}
          <div className="space-y-4">
            <div>
              <label
                htmlFor="title"
                className="block text-sm font-medium text-gray-700 mb-2"
              >
                Job Title (Optional)
              </label>
              <input
                id="title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g., Senior Frontend Developer"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                disabled={isAnalyzing}
              />
            </div>

            <div>
              <label
                htmlFor="jobDescription"
                className="block text-sm font-medium text-gray-700 mb-2"
              >
                Job Description *
              </label>
              <textarea
                id="jobDescription"
                value={jobDescription}
                onChange={(e) => setJobDescription(e.target.value)}
                placeholder="Paste the complete job description here..."
                rows={10}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-vertical"
                disabled={isAnalyzing}
              />
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
                {error}
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={analyzeJD}
                disabled={isAnalyzing || !jobDescription.trim()}
                className={`px-6 py-2 rounded-md font-medium ${
                  isAnalyzing || !jobDescription.trim()
                    ? "bg-gray-300 text-gray-500 cursor-not-allowed"
                    : "bg-blue-600 text-white hover:bg-blue-700"
                }`}
              >
                {isAnalyzing ? "Analyzing..." : "Analyze Job Description"}
              </button>

              {result && (
                <button
                  onClick={clearForm}
                  className="px-6 py-2 rounded-md font-medium bg-gray-200 text-gray-700 hover:bg-gray-300"
                >
                  Clear & Start Over
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Thinking Progress */}
        {showThinking && (
          <div className="bg-white rounded-lg shadow-md mb-6">
            <div
              className="flex items-center justify-between p-6 cursor-pointer hover:bg-gray-50 transition-colors"
              onClick={() => setIsThinkingCollapsed(!isThinkingCollapsed)}
            >
              <div className="flex items-center space-x-3">
                <h3 className="text-lg font-semibold text-gray-900">
                  🤖 AI Analysis in Progress
                </h3>
                <div className="flex items-center space-x-2">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                  <span className="text-sm text-gray-600">
                    {
                      thinkingPhases.filter((p) => p.status === "completed")
                        .length
                    }{" "}
                    / {thinkingPhases.length} complete
                  </span>
                </div>
              </div>
              <div className="flex items-center space-x-3">
                <div className="w-20 bg-gray-200 rounded-full h-2">
                  <div
                    className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                    style={{
                      width: `${
                        (thinkingPhases.filter((p) => p.status === "completed")
                          .length /
                          thinkingPhases.length) *
                        100
                      }%`,
                    }}
                  ></div>
                </div>
                <svg
                  className={`w-5 h-5 text-gray-400 transition-transform duration-200 ${
                    isThinkingCollapsed ? "rotate-180" : ""
                  }`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 9l-7 7-7-7"
                  />
                </svg>
              </div>
            </div>

            {!isThinkingCollapsed && (
              <div className="px-6 pb-6">
                <div className="space-y-3">
                  {thinkingPhases.map((phase, index) => (
                    <div
                      key={phase.id}
                      className={`flex items-center space-x-3 p-3 rounded-lg transition-all duration-300 ${
                        phase.status === "active"
                          ? "bg-blue-50 border border-blue-200"
                          : phase.status === "completed"
                          ? "bg-green-50 border border-green-200"
                          : "bg-gray-50 border border-gray-200"
                      }`}
                    >
                      <div className="flex-shrink-0">
                        {phase.status === "completed" && (
                          <div className="w-6 h-6 bg-green-500 rounded-full flex items-center justify-center">
                            <svg
                              className="w-3 h-3 text-white"
                              fill="currentColor"
                              viewBox="0 0 20 20"
                            >
                              <path
                                fillRule="evenodd"
                                d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                                clipRule="evenodd"
                              />
                            </svg>
                          </div>
                        )}
                        {phase.status === "active" && (
                          <div className="w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center">
                            <div className="w-2 h-2 bg-white rounded-full animate-pulse"></div>
                          </div>
                        )}
                        {phase.status === "pending" && (
                          <div className="w-6 h-6 bg-gray-300 rounded-full flex items-center justify-center">
                            <div className="w-2 h-2 bg-gray-500 rounded-full"></div>
                          </div>
                        )}
                      </div>

                      <div className="flex-1">
                        <div
                          className={`font-medium ${
                            phase.status === "active"
                              ? "text-blue-900"
                              : phase.status === "completed"
                              ? "text-green-900"
                              : "text-gray-600"
                          }`}
                        >
                          {phase.label}
                        </div>
                        <div
                          className={`text-sm ${
                            phase.status === "active"
                              ? "text-blue-700"
                              : phase.status === "completed"
                              ? "text-green-700"
                              : "text-gray-500"
                          }`}
                        >
                          {phase.description}
                        </div>
                      </div>

                      {phase.status === "active" && (
                        <div className="flex-shrink-0">
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Results */}
        {result && (
          <div className="space-y-6">
            {/* Status Message */}
            <div className="bg-white rounded-lg shadow-md p-6">
              <div className="flex items-start space-x-3">
                <div className="flex-shrink-0">
                  {result.source === "similar_jd" ? (
                    <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center">
                      <span className="text-green-600 text-lg">✨</span>
                    </div>
                  ) : (
                    <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                      <span className="text-blue-600 text-lg">🤖</span>
                    </div>
                  )}
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">
                    {result.source === "similar_jd"
                      ? "Similar Job Description Found!"
                      : "Skills Extracted Successfully!"}
                  </h3>
                  <p className="text-gray-600 mt-1">{result.message}</p>
                </div>
              </div>
            </div>

            {/* Similar JDs (if found) */}
            {result.similarJDs && result.similarJDs.length > 0 && (
              <div className="bg-white rounded-lg shadow-md p-6">
                <h3 className="text-xl font-semibold text-gray-900 mb-4">
                  Similar Job Descriptions
                </h3>
                <div className="space-y-3">
                  {result.similarJDs.map((jd) => (
                    <div
                      key={jd.id}
                      className="border border-gray-200 rounded-lg p-4"
                    >
                      <div className="flex justify-between items-start mb-2">
                        <h4 className="font-medium text-gray-900">
                          {jd.title || "Untitled Job Description"}
                        </h4>
                        <span className="bg-green-100 text-green-800 text-xs font-medium px-2 py-1 rounded">
                          {(jd.similarity * 100).toFixed(1)}% match
                        </span>
                      </div>
                      <p className="text-gray-600 text-sm">{jd.content}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Skills Table */}
            <SkillsTable skills={result.skills} />

            {/* Interview Questions - Skill-wise Collapsible Cards */}
            <div className="bg-white rounded-lg shadow-md overflow-hidden">
              <div className="px-6 py-4 bg-gray-50 border-b border-gray-200">
                <h3 className="text-lg font-semibold text-gray-900">
                  Interview Questions (
                  {result.skills.reduce(
                    (total, skill) => total + skill.questions.length,
                    0
                  )}
                  )
                </h3>
                <p className="text-sm text-gray-600 mt-1">
                  Click on each skill to view and navigate through interview
                  questions
                </p>
              </div>

              <div className="divide-y divide-gray-200">
                {result.skills.map((skill) => {
                  const isExpanded = expandedSkills.has(skill.id);
                  const currentPage = skillQuestionPages[skill.id] || 1;
                  const totalPages = getTotalPages(skill.questions.length, 5);
                  const displayedQuestions = getSkillQuestions(
                    skill.questions,
                    currentPage,
                    5
                  );

                  return (
                    <div
                      key={skill.id}
                      className="border-b border-gray-200 last:border-b-0"
                    >
                      {/* Skill Header */}
                      <div
                        className="px-6 py-4 cursor-pointer hover:bg-gray-50 transition-colors"
                        onClick={() => toggleSkillExpansion(skill.id)}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-3">
                            <h4 className="text-lg font-medium text-gray-900">
                              {skill.name}
                            </h4>
                            <div className="flex space-x-2">
                              {(skill.existingCount ||
                                skill.questions.filter(
                                  (q) => q.source === "existing"
                                ).length) > 0 && (
                                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
                                  {skill.existingCount ||
                                    skill.questions.filter(
                                      (q) => q.source === "existing"
                                    ).length}{" "}
                                  existing
                                </span>
                              )}
                              {(skill.similarCount ||
                                skill.questions.filter(
                                  (q) => q.source === "similar"
                                ).length) > 0 && (
                                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-800">
                                  {skill.similarCount ||
                                    skill.questions.filter(
                                      (q) => q.source === "similar"
                                    ).length}{" "}
                                  similar
                                </span>
                              )}
                              {(skill.generatedCount ||
                                skill.questions.filter(
                                  (q) => q.source === "generated"
                                ).length) > 0 && (
                                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">
                                  {skill.generatedCount ||
                                    skill.questions.filter(
                                      (q) => q.source === "generated"
                                    ).length}{" "}
                                  generated
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center space-x-3">
                            <span className="text-sm text-gray-500">
                              {skill.questions.length} questions
                            </span>
                            <svg
                              className={`w-5 h-5 text-gray-400 transition-transform duration-200 ${
                                isExpanded ? "rotate-180" : ""
                              }`}
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M19 9l-7 7-7-7"
                              />
                            </svg>
                          </div>
                        </div>
                      </div>

                      {/* Questions Content */}
                      {isExpanded && (
                        <div className="px-6 pb-4">
                          {/* Questions List */}
                          <div className="space-y-3 mb-4">
                            {displayedQuestions.map((question, index) => (
                              <div
                                key={index}
                                className="border border-gray-200 rounded-lg p-4 bg-gray-50"
                              >
                                <div className="flex items-start justify-between">
                                  <div className="flex-1">
                                    <p className="text-gray-900 leading-relaxed">
                                      {question.text}
                                    </p>
                                  </div>
                                  <div className="ml-4 flex flex-col items-end space-y-2">
                                    <span
                                      className={`px-2 py-1 rounded-full text-xs font-medium ${
                                        question.source === "existing"
                                          ? "bg-green-100 text-green-800"
                                          : question.source === "similar"
                                          ? "bg-yellow-100 text-yellow-800"
                                          : "bg-blue-100 text-blue-800"
                                      }`}
                                    >
                                      {question.source}
                                    </span>
                                    {/* <span className="text-xs text-gray-500">
                                      {(question.confidence * 100).toFixed(1)}%
                                    </span> */}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>

                          {/* Pagination */}
                          {totalPages > 1 && (
                            <div className="flex items-center justify-between">
                              <div className="text-sm text-gray-700">
                                Showing {(currentPage - 1) * 5 + 1} to{" "}
                                {Math.min(
                                  currentPage * 5,
                                  skill.questions.length
                                )}{" "}
                                of {skill.questions.length} questions
                              </div>
                              <div className="flex items-center space-x-2">
                                <button
                                  onClick={() =>
                                    setSkillPage(
                                      skill.id,
                                      Math.max(1, currentPage - 1)
                                    )
                                  }
                                  disabled={currentPage === 1}
                                  className={`px-3 py-1 rounded-md text-sm ${
                                    currentPage === 1
                                      ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                                      : "bg-white border border-gray-300 text-gray-700 hover:bg-gray-50"
                                  }`}
                                >
                                  Previous
                                </button>

                                <div className="flex space-x-1">
                                  {Array.from(
                                    { length: totalPages },
                                    (_, i) => i + 1
                                  ).map((page) => (
                                    <button
                                      key={page}
                                      onClick={() =>
                                        setSkillPage(skill.id, page)
                                      }
                                      className={`px-3 py-1 rounded-md text-sm ${
                                        page === currentPage
                                          ? "bg-blue-600 text-white"
                                          : "bg-white border border-gray-300 text-gray-700 hover:bg-gray-50"
                                      }`}
                                    >
                                      {page}
                                    </button>
                                  ))}
                                </div>

                                <button
                                  onClick={() =>
                                    setSkillPage(
                                      skill.id,
                                      Math.min(totalPages, currentPage + 1)
                                    )
                                  }
                                  disabled={currentPage === totalPages}
                                  className={`px-3 py-1 rounded-md text-sm ${
                                    currentPage === totalPages
                                      ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                                      : "bg-white border border-gray-300 text-gray-700 hover:bg-gray-50"
                                  }`}
                                >
                                  Next
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
