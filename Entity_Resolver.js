import { driver, invokeLLM } from "./Config.js";

const NODE_TYPES = [
  { label: "Movie", property: "title" },
  { label: "Director", property: "name" },
  { label: "Actor", property: "name" },
  { label: "Genre", property: "name" },
  { label: "Theme", property: "name" },
  { label: "Award", property: "name" },
];

function cleanJson(raw) {
  return raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
}

async function extractEntities(query) {

  const systemPrompt = `Extract entity names from movie-related queries.

Extract person names, movie titles, genre names, theme names, and award names.
Do not extract generic words such as "movies", "recommend", "find", "show", "list", or "good".

Examples:
"Movies directed by Christopher Nolan" -> ["Christopher Nolan"]
"Action movies with Tom Hardy" -> ["Action", "Tom Hardy"]
"How is DiCaprio related to Nolan?" -> ["DiCaprio", "Nolan"]
"Tell me about Inception" -> ["Inception"]
"Movies like Inception" -> ["Inception"]
"Sci-fi movies that won Oscar" -> ["Sci-fi", "Oscar"]
"Recommend me a thriller" -> ["thriller"]
"Movies about dreams and reality" -> ["dreams", "reality"]

Return only a JSON array of strings. No markdown.`;

  try {
    const raw = await invokeLLM(systemPrompt, query);
    const parsed = JSON.parse(cleanJson(raw));
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch (err) {
    console.warn("Entity extraction failed, continuing without resolved entities.");
    return [];
  }
}

async function resolveEntity(entityName) {

  const session = driver.session({ defaultAccessMode: "READ" });
  const matches = [];

  try {
    for (const { label, property } of NODE_TYPES) {
      
      const exactResult = await session.run(
        
        `MATCH (n:${label})
         WHERE toLower(n.${property}) = toLower($name)
         RETURN n.${property} AS nodeName, labels(n)[0] AS label
         LIMIT 5`,
        { name: entityName }
      );

      if (exactResult.records.length > 0) {
        for (const record of exactResult.records) {
          matches.push({
            searchTerm: entityName,
            label: record.get("label"),
            nodeName: record.get("nodeName"),
            matchType: "exact",
          });
        }
        continue;
      }

      const partialResult = await session.run(
        `MATCH (n:${label})
         WHERE toLower(n.${property}) CONTAINS toLower($name)
         RETURN n.${property} AS nodeName, labels(n)[0] AS label
         LIMIT 5`,
        { name: entityName }
      );

      for (const record of partialResult.records) {
        matches.push({
          searchTerm: entityName,
          label: record.get("label"),
          nodeName: record.get("nodeName"),
          matchType: "partial",
        });
      }
    }


  } finally {
    await session.close();
  }

  const exactMatches = matches.filter((match) => match.matchType === "exact");
  return exactMatches.length > 0 ? exactMatches : matches;
}

async function resolveQueryEntities(query) {

  console.log("Step 1: extracting entities from query");

  const entityNames = await extractEntities(query);

  console.log(`Found terms: [${entityNames.join(", ")}]`);

  if (entityNames.length === 0) {
    return { query, entities: [], unresolved: [] };
  }

  console.log("Step 2: resolving entities in Neo4j");

  const resolved = [];
  const unresolved = [];

  for (const name of entityNames) {
    const matches = await resolveEntity(name);

    if (matches.length > 0) {
      for (const match of matches) {
        resolved.push(match);
        console.log(`"${name}" -> ${match.label} (${match.nodeName}) [${match.matchType}]`);
      }
    } else {
      unresolved.push(name);
      console.log(`"${name}" -> not found in graph`);
    }
  }

  return { query, entities: resolved, unresolved };
}

export { resolveQueryEntities, resolveEntity };
