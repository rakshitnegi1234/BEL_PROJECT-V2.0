import { invokeLLM } from "./Config.js";

function cleanModelJson(modelText) {
  return modelText.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
}

function classifyWithRules(query) {
  const lowerQuery = query.toLowerCase();

  // These rules are the fallback when the LLM classifier fails or returns bad JSON.
  const graphPatterns = [
    "directed by",
    "acted in",
    "work in",
    "worked in",
    "works in",
    "work on",
    "worked on",
    "works on",
    "where",
    "who is",
    "tell me about",
    "how many",
    "list",
    "show",
    "with actor",
    "by director",
    "won",
  ];

  const similarityPatterns = [
    "similar to",
    "movies like",
    "films like",
    "like inception",
    "liked",
    "watch next after",
    "what should i watch after",
    "same vibe",
    "similar vibe",
    "similar movies",
    "similar films",
  ];

  if (graphPatterns.some((pattern) => lowerQuery.includes(pattern))) {
    return {
      type: "graph",
      reasoning: "The query asks for movies matching explicit graph facts or entity relationships.",
    };
  }

  if (similarityPatterns.some((pattern) => lowerQuery.includes(pattern))) {
    return {
      type: "similarity",
      reasoning: "The query asks for movies similar in taste, theme, or viewing preference.",
    };
  }

  return {
    type: "graph",
    reasoning: "The query asks for factual information that can be answered from the graph.",
  };
}






async function classifyQuery(query, resolvedEntities) {

  let entityContext = "No entities were resolved from Neo4j.";
  
  if (resolvedEntities.entities.length > 0) {

      entityContext = resolvedEntities.entities
      .map((entity) => `"${entity.searchTerm}" is a ${entity.label} with database name "${entity.nodeName}"`)
      .join("\n");
  }

  let unresolvedContext = "";

  if (resolvedEntities.unresolved.length > 0) {
    unresolvedContext = `\nUnresolved terms: ${resolvedEntities.unresolved.join(", ")}`;
  }

  const systemPrompt = `You classify movie questions for a GraphRAG system.

Resolved entities:
${entityContext}   

${unresolvedContext}

Return exactly one JSON object:
{"type":"graph","reasoning":"one sentence"}
or
{"type":"similarity","reasoning":"one sentence"}

Definitions:

"graph" means the question should be answered from exact stored facts and relationships in Neo4j:
- who a person is
- movies by a director
- movies an actor worked in
- movies with a genre, theme, award, year, actor, or director
- counts, lists, filters, descriptions, and relationship/path questions
- any query using "where", "worked in", "worked on", "directed by", "acted in", "won", "with", "by", "list", "show", "tell me about", or "how many"

"similarity" means the question needs semantic/taste recommendation from Pinecone:
- movies similar to a movie
- movies like a movie
- what to watch next after liking a movie
- same vibe/style/theme as a movie

Important edge rule:

If the user says "recommend" but also gives an exact factual condition such as "where Christopher Nolan works", "directed by Nolan", or "with Zendaya", classify as "graph".
The word "recommend" alone does not mean similarity. Similarity requires "similar", "like", "liked", "same vibe", or "watch next after".

Examples:
User: "Recommend me movies where Christopher Nolan works"
Answer: {"type":"graph","reasoning":"The user wants movies connected to Christopher Nolan by stored graph relationships."}

User: "Give me 10 movies where Christopher Nolan worked"
Answer: {"type":"graph","reasoning":"The user asks for an exact list of movies connected to a person."}

User: "Movies directed by Christopher Nolan"
Answer: {"type":"graph","reasoning":"The query asks for movies by a specific director."}

User: "Tell me all the movies Zendaya worked on"
Answer: {"type":"graph","reasoning":"The query asks for movies connected to an actor."}

User: "Movies like Inception"
Answer: {"type":"similarity","reasoning":"The query asks for movies similar to a known movie."}

User: "I liked Interstellar, what should I watch next?"
Answer: {"type":"similarity","reasoning":"The query asks for recommendations based on taste similarity."}

Return only JSON. No markdown.`;


  try {

    const modelText = await invokeLLM(systemPrompt, query);
    const modelChoice = JSON.parse(cleanModelJson(modelText));

    if (modelChoice.type === "graph" || modelChoice.type === "similarity") {

      return {
        type: modelChoice.type,
        reasoning: modelChoice.reasoning || "Classified by query intent.",
      };
    }
  } 
  
  catch (error) {

    console.warn("Classification failed, using rule-based fallback.");
  }

  return classifyWithRules(query);

}

export { classifyQuery };
