import { driver, embedText, invokeLLM, pineconeIndex } from "./Config.js";

const VECTOR_TOP_K = 30;
const FINAL_RECOMMENDATION_COUNT = 10;

function normalizeTitleForComparison(title) {
  return String(title || "")
    .toLowerCase()
    .replace(/\(\d{4}\)/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function toPlainValue(value) {
  return value && typeof value === "object" && typeof value.toNumber === "function"
    ? value.toNumber()
    : value;
}

function readMatchTitle(vectorMatch) {
  return vectorMatch.metadata?.title || null;
}

function isRequestedSourceTitle(candidateTitle, sourceTerms) {
  const normalizedCandidate = normalizeTitleForComparison(candidateTitle);
  return sourceTerms.some((sourceTerm) => {
    const normalizedSourceTerm = normalizeTitleForComparison(sourceTerm);
    return normalizedSourceTerm && normalizedCandidate === normalizedSourceTerm;
  });
}

function getRequestedSourceTerms(sourceMovie, resolvedEntities) {
  return [
    ...new Set(
      [sourceMovie?.nodeName, sourceMovie?.searchTerm, ...(resolvedEntities.unresolved || [])].filter(Boolean)
    ),
  ];
}

function movieFromRecord(record) {
  return {
    title: record.get("title"),
    year: toPlainValue(record.get("year")),
    directors: record.get("directors"),
    actors: record.get("actors"),
    genres: record.get("genres"),
    themes: record.get("themes"),
  };
}

async function getMovieContexts(movieTitles) {
  const uniqueTitles = [...new Set(movieTitles.filter(Boolean))];
  if (uniqueTitles.length === 0) {
    return [];
  }

  const session = driver.session({ defaultAccessMode: "READ" });

  try {
    const queryResult = await session.run(
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

    const moviesByTitle = new Map(queryResult.records.map((record) => [record.get("title"), movieFromRecord(record)]));

    return uniqueTitles.map((title) => moviesByTitle.get(title)).filter(Boolean);
  } finally {
    await session.close();
  }
}

function countOverlap(leftItems = [], rightItems = []) {
  const lowerRightItems = new Set(rightItems.map((item) => String(item).toLowerCase()));
  return leftItems.filter((item) => lowerRightItems.has(String(item).toLowerCase())).length;
}

function rankCandidates(candidates, vectorMatches, sourceContext) {
  const matchesByTitle = new Map(
    vectorMatches.map((match) => [readMatchTitle(match), match]).filter(([title]) => title)
  );

  return candidates
    .map((candidate) => {
      const match = matchesByTitle.get(candidate.title);
      return {
        ...candidate,
        vectorScore: match?.score || 0,
        embeddedText: match?.metadata?.text || "",
        genreOverlap: countOverlap(candidate.genres, sourceContext?.genres || []),
        themeOverlap: countOverlap(candidate.themes, sourceContext?.themes || []),
      };
    })
    .sort(
      (leftMovie, rightMovie) =>
        rightMovie.genreOverlap - leftMovie.genreOverlap ||
        rightMovie.themeOverlap - leftMovie.themeOverlap ||
        rightMovie.vectorScore - leftMovie.vectorScore
    );
}

async function searchVectorIndex(queryText) {
  const queryVector = await embedText(queryText);

  const searchResults = await pineconeIndex.query({
    vector: queryVector,
    topK: VECTOR_TOP_K,
    includeMetadata: true,
  });

  return searchResults.matches || [];
}

async function answerSimilarityQuery(query, resolvedEntities) {
  const sourceMovie = resolvedEntities.entities.find((entity) => entity.label === "Movie");
  const sourceMovieTitle = sourceMovie?.nodeName || null;
  const requestedSourceTerms = getRequestedSourceTerms(sourceMovie, resolvedEntities);

  console.log(
    sourceMovieTitle
      ? `Finding movies similar to "${sourceMovieTitle}"`
      : "No source movie was resolved. Using the full query for vector search."
  );

  console.log(`Searching Pinecone top ${VECTOR_TOP_K}`);
  const vectorMatches = await searchVectorIndex(sourceMovieTitle || query);

  if (vectorMatches.length === 0) {
    return "I could not find matching movies.";
  }

  const candidateTitles = vectorMatches
    .map(readMatchTitle)
    .filter((title) => title && !isRequestedSourceTitle(title, requestedSourceTerms));

  console.log(`Pinecone returned ${candidateTitles.length} candidate titles`);

  const movieContexts = await getMovieContexts(sourceMovieTitle ? [sourceMovieTitle, ...candidateTitles] : candidateTitles);
  const sourceContext = sourceMovieTitle
    ? movieContexts.find((movie) => movie.title === sourceMovieTitle) || null
    : null;
  const graphCandidates = movieContexts.filter((movie) => !isRequestedSourceTitle(movie.title, requestedSourceTerms));

  if (graphCandidates.length === 0) {
    return "I found vector matches, but I could not fetch their graph details from Neo4j.";
  }

  const rankedCandidates = rankCandidates(graphCandidates, vectorMatches, sourceContext).slice(0, VECTOR_TOP_K);
  console.log(`Neo4j returned ${rankedCandidates.length} enriched candidates`);

  const sourcePromptText = sourceContext
    ? `Source movie:\n${JSON.stringify(sourceContext, null, 2)}`
    : requestedSourceTerms.length
      ? `Requested source movie terms:\n${JSON.stringify(requestedSourceTerms, null, 2)}

The source movie was not resolved in the graph. Do not recommend the requested source movie itself.`
      : "No single source movie was resolved. Rank by the user's query intent.";

  const systemPrompt = `You are a movie recommendation assistant.
Always recommend exactly ${FINAL_RECOMMENDATION_COUNT} movies if at least ${FINAL_RECOMMENDATION_COUNT} candidates are available.
Use only movies present in the candidate list.
Use the source movie, graph facts, genre overlap, theme overlap, and candidate text to rank the best matches.
Do not include the source movie itself as a recommendation.
If fewer than ${FINAL_RECOMMENDATION_COUNT} candidates are available, return only the available candidates.
Do not mention databases, Pinecone, Neo4j, vectors, scores, JSON, or technical details.
Return a numbered list with a short reason for each movie.`;

  const userPrompt = `User query:
${query}

${sourcePromptText}

Candidates from vector search enriched with graph facts:
${JSON.stringify(rankedCandidates, null, 2)}

Return the final top ${Math.min(FINAL_RECOMMENDATION_COUNT, rankedCandidates.length)} recommendations.`;

  const finalAnswer = await invokeLLM(systemPrompt, userPrompt);
  return finalAnswer.trim();
}

export { answerSimilarityQuery };
