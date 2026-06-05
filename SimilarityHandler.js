import { driver, embedText, invokeLLM, pineconeIndex } from "./Config.js";

const VECTOR_TOP_K = 30;
const FINAL_RECOMMENDATION_COUNT = 10;

function normalizeValue(value) {
  if (value && typeof value === "object" && typeof value.toNumber === "function") {
    return value.toNumber();
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeValue(item));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, normalizeValue(item)])
    );
  }
  return value;
}

function getMatchTitle(match) {
  return match.metadata?.title || null;
}

async function getMovieContext(movieTitle) {
  const session = driver.session({ defaultAccessMode: "READ" });
  try {
    const result = await session.run(
      `MATCH (m:Movie {title: $title})
       OPTIONAL MATCH (d:Director)-[:DIRECTED]->(m)
       OPTIONAL MATCH (a:Actor)-[:ACTED_IN]->(m)
       OPTIONAL MATCH (m)-[:BELONGS_TO]->(g:Genre)
       OPTIONAL MATCH (m)-[:EXPLORES]->(t:Theme)
       RETURN m.title AS title,
              m.year AS year,
              collect(DISTINCT d.name) AS directors,
              collect(DISTINCT a.name) AS actors,
              collect(DISTINCT g.name) AS genres,
              collect(DISTINCT t.name) AS themes`,
      { title: movieTitle }
    );

    if (result.records.length === 0) return null;

    const record = result.records[0];
    return {
      title: record.get("title"),
      year: normalizeValue(record.get("year")),
      directors: record.get("directors"),
      actors: record.get("actors"),
      genres: record.get("genres"),
      themes: record.get("themes"),
    };
  } finally {
    await session.close();
  }
}

async function getMoviesContext(movieTitles) {
  const uniqueTitles = [...new Set(movieTitles.filter(Boolean))];
  if (uniqueTitles.length === 0) return [];

  const session = driver.session({ defaultAccessMode: "READ" });
  try {
    const result = await session.run(
      `MATCH (m:Movie)
       WHERE m.title IN $titles
       OPTIONAL MATCH (d:Director)-[:DIRECTED]->(m)
       OPTIONAL MATCH (a:Actor)-[:ACTED_IN]->(m)
       OPTIONAL MATCH (m)-[:BELONGS_TO]->(g:Genre)
       OPTIONAL MATCH (m)-[:EXPLORES]->(t:Theme)
       RETURN m.title AS title,
              m.year AS year,
              collect(DISTINCT d.name) AS directors,
              collect(DISTINCT a.name) AS actors,
              collect(DISTINCT g.name) AS genres,
              collect(DISTINCT t.name) AS themes`,
      { titles: uniqueTitles }
    );

    const byTitle = new Map();
    for (const record of result.records) {
      byTitle.set(record.get("title"), {
        title: record.get("title"),
        year: normalizeValue(record.get("year")),
        directors: record.get("directors"),
        actors: record.get("actors"),
        genres: record.get("genres"),
        themes: record.get("themes"),
      });
    }

    return uniqueTitles.map((title) => byTitle.get(title)).filter(Boolean);
  } finally {
    await session.close();
  }
}

function overlapCount(left = [], right = []) {
  const lowerRight = new Set(right.map((item) => String(item).toLowerCase()));
  return left.filter((item) => lowerRight.has(String(item).toLowerCase())).length;
}

function attachScores(candidates, matches, sourceContext) {
  const scoreByTitle = new Map();
  const textByTitle = new Map();

  for (const match of matches) {
    const title = getMatchTitle(match);
    if (!title) continue;
    scoreByTitle.set(title, match.score ?? 0);
    textByTitle.set(title, match.metadata?.text || "");
  }

  return candidates
    .map((candidate) => ({
      ...candidate,
      vectorScore: scoreByTitle.get(candidate.title) || 0,
      embeddedText: textByTitle.get(candidate.title) || "",
      genreOverlap: overlapCount(candidate.genres, sourceContext?.genres || []),
      themeOverlap: overlapCount(candidate.themes, sourceContext?.themes || []),
    }))
    .sort((a, b) => {
      if (b.genreOverlap !== a.genreOverlap) return b.genreOverlap - a.genreOverlap;
      if (b.themeOverlap !== a.themeOverlap) return b.themeOverlap - a.themeOverlap;
      return b.vectorScore - a.vectorScore;
    });
}

async function queryPinecone(queryText) {
  const queryVector = await embedText(queryText);
  const searchResults = await pineconeIndex.query({
    vector: queryVector,
    topK: VECTOR_TOP_K,
    includeMetadata: true,
  });

  return searchResults.matches || [];
}

async function handleSimilarityQuery(query, resolvedEntities) {
  const movieEntity = resolvedEntities.entities.find((entity) => entity.label === "Movie");
  const sourceMovieTitle = movieEntity?.nodeName || null;
  const searchText = sourceMovieTitle || query;

  if (sourceMovieTitle) {
    console.log(`Finding movies similar to "${sourceMovieTitle}"`);
  } else {
    console.log("No source movie was resolved. Using the full query for vector search.");
  }

  console.log(`Searching Pinecone top ${VECTOR_TOP_K}`);
  const matches = await queryPinecone(searchText);

  if (matches.length === 0) {
    return "I could not find matching movies.";
  }

  const candidateTitles = matches
    .map(getMatchTitle)
    .filter((title) => title && title.toLowerCase() !== sourceMovieTitle?.toLowerCase());

  console.log(`Pinecone returned ${candidateTitles.length} candidate titles`);

  let sourceContext = null;
  if (sourceMovieTitle) {
    sourceContext = await getMovieContext(sourceMovieTitle);
  }

  const graphCandidates = await getMoviesContext(candidateTitles);
  if (graphCandidates.length === 0) {
    return "I found vector matches, but I could not fetch their graph details from Neo4j.";
  }

  const rankedCandidates = attachScores(graphCandidates, matches, sourceContext).slice(0, VECTOR_TOP_K);
  console.log(`Neo4j returned ${rankedCandidates.length} enriched candidates`);

  const sourceBlock = sourceContext
    ? `Source movie:
${JSON.stringify(sourceContext, null, 2)}`
    : "No single source movie was resolved. Rank by the user's query intent.";

  const systemPrompt = `You are a movie recommendation assistant.
Always recommend exactly ${FINAL_RECOMMENDATION_COUNT} movies if at least ${FINAL_RECOMMENDATION_COUNT} candidates are available.
Use the source movie, graph facts, genre overlap, theme overlap, and candidate text to rank the best matches.
Do not mention databases, Pinecone, Neo4j, vectors, scores, JSON, or technical details.
Return a numbered list with a short reason for each movie.`;

  const userPrompt = `User query:
${query}

${sourceBlock}

Candidates from vector search enriched with graph facts:
${JSON.stringify(rankedCandidates, null, 2)}

Return the final top ${Math.min(FINAL_RECOMMENDATION_COUNT, rankedCandidates.length)} recommendations.`;

  const answer = await invokeLLM(systemPrompt, userPrompt);
  return answer.trim();
}

export { handleSimilarityQuery };
