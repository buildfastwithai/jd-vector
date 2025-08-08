"use client";

interface Question {
  text: string;
  confidence: number;
  source: "existing" | "generated";
}

interface Skill {
  id: number;
  name: string;
  confidence: number;
  source?: "existing" | "extracted";
  questions: Question[];
}

interface QuestionsTableProps {
  skills: Skill[];
}

export default function QuestionsTable({ skills }: QuestionsTableProps) {
  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 0.9) return "text-green-600 bg-green-50";
    if (confidence >= 0.7) return "text-yellow-600 bg-yellow-50";
    return "text-red-600 bg-red-50";
  };

  const getConfidenceBadge = (confidence: number) => {
    const percentage = (confidence * 100).toFixed(1);
    return (
      <span
        className={`px-2 py-1 rounded-full text-xs font-medium ${getConfidenceColor(
          confidence
        )}`}
      >
        {percentage}%
      </span>
    );
  };

  const getSourceBadge = (source: "existing" | "generated") => {
    return (
      <span
        className={`px-2 py-1 rounded-full text-xs font-medium ${
          source === "existing"
            ? "text-green-600 bg-green-50"
            : "text-blue-600 bg-blue-50"
        }`}
      >
        {source}
      </span>
    );
  };

  // Flatten all questions with their skill context
  const allQuestions = skills.flatMap((skill) =>
    skill.questions.map((question) => ({
      ...question,
      skillName: skill.name,
      skillId: skill.id,
    }))
  );

  return (
    <div className="bg-white rounded-lg shadow-md overflow-hidden">
      <div className="px-6 py-4 bg-gray-50 border-b border-gray-200">
        <h3 className="text-lg font-semibold text-gray-900">
          Interview Questions ({allQuestions.length})
        </h3>
        <p className="text-sm text-gray-600 mt-1">
          Generated and retrieved questions with confidence scores
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Skill
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-2/3">
                Question
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Confidence
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Source
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {allQuestions.map((question, index) => (
              <tr
                key={`${question.skillId}-${index}`}
                className={index % 2 === 0 ? "bg-white" : "bg-gray-50"}
              >
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm font-medium text-gray-900">
                    {question.skillName}
                  </div>
                </td>
                <td className="px-6 py-4">
                  <div className="text-sm text-gray-900 break-words overflow-wrap-anywhere">
                    <p className="leading-relaxed">{question.text}</p>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  {getConfidenceBadge(question.confidence)}
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  {getSourceBadge(question.source)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {allQuestions.length === 0 && (
        <div className="px-6 py-8 text-center">
          <p className="text-gray-500 text-sm">No questions available</p>
        </div>
      )}
    </div>
  );
}
