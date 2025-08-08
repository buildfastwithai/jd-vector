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

interface SkillsTableProps {
  skills: Skill[];
}

export default function SkillsTable({ skills }: SkillsTableProps) {
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

  const getSourceBadge = (source: "existing" | "extracted" | undefined) => {
    if (!source) return null;
    return (
      <span
        className={`px-2 py-1 rounded-full text-xs font-medium ${
          source === "existing"
            ? "text-blue-600 bg-blue-50"
            : "text-purple-600 bg-purple-50"
        }`}
      >
        {source}
      </span>
    );
  };

  return (
    <div className="bg-white rounded-lg shadow-md overflow-hidden">
      <div className="px-6 py-4 bg-gray-50 border-b border-gray-200">
        <h3 className="text-lg font-semibold text-gray-900">
          Extracted Skills ({skills.length})
        </h3>
        <p className="text-sm text-gray-600 mt-1">
          Skills identified with confidence scores and source information
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Skill Name
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Confidence
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Source
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Questions Available
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {skills.map((skill, index) => (
              <tr
                key={skill.id}
                className={index % 2 === 0 ? "bg-white" : "bg-gray-50"}
              >
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm font-medium text-gray-900">
                    {skill.name}
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  {getConfidenceBadge(skill.confidence)}
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  {getSourceBadge(skill.source)}
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center space-x-2">
                    <span className="text-sm text-gray-900">
                      {skill.questions.length} questions
                    </span>
                    <div className="flex space-x-1">
                      {skill.questions.some((q) => q.source === "existing") && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
                          {
                            skill.questions.filter(
                              (q) => q.source === "existing"
                            ).length
                          }{" "}
                          existing
                        </span>
                      )}
                      {skill.questions.some(
                        (q) => q.source === "generated"
                      ) && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">
                          {
                            skill.questions.filter(
                              (q) => q.source === "generated"
                            ).length
                          }{" "}
                          generated
                        </span>
                      )}
                    </div>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
