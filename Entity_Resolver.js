import { driver, invokeLLM } from "./Config.js";

const NODE_TYPES = [
  { label: "Movie", property: "title" },
  { label: "Director", property: "name" },
  { label: "Actor", property: "name" },
  { label: "Genre", property: "name" },
  { label: "Theme", property: "name" },
  { label: "Award", property: "name" },
];

function cleanModelJson(modelText) {
  return modelText.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
}

async function findEntityNames(query) {

  const systemPrompt =

  `Extract entity names from movie-related queries.

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

    const modelText = await invokeLLM(systemPrompt, query);

    const entityNames = JSON.parse(cleanModelJson(modelText));

    return entityNames;


  } catch (error)
   {

    console.warn("Entity extraction failed, continuing without resolved entities.");
    return [];
  }
}


async function findEntityMatches(entityName) {

  const session = driver.session({ defaultAccessMode: "READ" });
  const entityMatches = [];

  try {
    for (const { label, property } of NODE_TYPES) {

      // Exact matches are preferred, but partial matches help with names like "Nolan".

      const exactResult = await session.run(
        `MATCH (n:${label})
         WHERE toLower(n.${property}) = toLower($name)
         RETURN n.${property} AS nodeName, labels(n)[0] AS label
         LIMIT 5`,
        { name: entityName }
      );

      if (exactResult.records.length > 0) {

        for (const record of exactResult.records) {

          entityMatches.push({
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

        entityMatches.push({
          searchTerm: entityName,
          label: record.get("label"),
          nodeName: record.get("nodeName"),
          matchType: "partial",
        });
      }
    }
  }

  finally {
    await session.close();
  }

  const exactMatches = entityMatches.filter((entityMatch) => entityMatch.matchType === "exact");

  if (exactMatches.length > 0) {
    return exactMatches;
  }

  return entityMatches;
}





async function resolveQueryEntities(query) {

  console.log("Step 1: extracting entities from query");

  const entityNames = await findEntityNames(query);


  if (entityNames.length === 0) {
    return { query, entities: [], unresolved: [] };
  }

  console.log("Step 2: resolving entities in Neo4j");

  const resolvedEntities = [];
  const unresolvedNames = [];

  for (const entityName of entityNames) {


    const entityMatches = await findEntityMatches(entityName);

    if (entityMatches.length > 0) {


      for (const entityMatch of entityMatches) {
        resolvedEntities.push(entityMatch);
      }
    }


    else {
      unresolvedNames.push(entityName);
    }
  }

  return { query, entities: resolvedEntities, unresolved: unresolvedNames };
}

export { resolveQueryEntities, findEntityMatches };
