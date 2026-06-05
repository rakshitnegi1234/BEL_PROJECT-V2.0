import { invokeLLM } from "./Config.js";

function cleanJson(raw) {
  return raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
}

function heuristicClassification(query) {
  const lower = query.toLowerCase();
  const similarityWords = [
    "similar",
    "recommend",
    "recommendation",
    "like",
    "liked",
    "watch next",
    "what should i watch",
  ];

  if (similarityWords.some((word) => lower.includes(word))) {
    return {
      type: "similarity",
      reasoning: "The query asks for recommendations or movies similar to another movie.",
    };
  }

  return {
    type: "graph",
    reasoning: "The query asks for factual information that can be answered from the graph.",
  };
}

async function classifyQuery(query, resolvedEntities) {
  const entityContext = resolvedEntities.entities.length > 0
    ? resolvedEntities.entities
        .map((e) => `"${e.searchTerm}" is a ${e.label} with database name "${e.nodeName}"`)
        .join("\n")
    : "No entities were resolved from Neo4j.";

  const unresolvedContext = resolvedEntities.unresolved.length > 0
    ? `\nUnresolved terms: ${resolvedEntities.unresolved.join(", ")}`
    : "";

  const systemPrompt = `You classify movie questions for a GraphRAG system.

Resolved entities:
${entityContext}${unresolvedContext}

Return exactly one JSON object:
{"type":"graph","reasoning":"one sentence"}
or
{"type":"similarity","reasoning":"one sentence"}

Use "similarity" only when the user asks for recommendations or movies similar to something.
Use "graph" for factual, count, list, relationship, director, actor, genre, theme, award, or description questions.
Return only JSON. No markdown.`;

  try {
    const raw = await invokeLLM(systemPrompt, query);
    const parsed = JSON.parse(cleanJson(raw));
    if (parsed.type === "graph" || parsed.type === "similarity") {
      return {
        type: parsed.type,
        reasoning: parsed.reasoning || "Classified by query intent.",
      };
    }
  } catch (err) {
    console.warn("Classification failed, using rule-based fallback.");
  }

  return heuristicClassification(query);
}

export { classifyQuery };
