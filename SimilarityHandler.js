import { driver, embedText, invokeLLM, pineconeIndex } from "./Config.js";

const VECTOR_TOP_K = 30;
const FINAL_RECOMMENDATION_COUNT = 10;

async function getMovieContexts(movieTitles) {

  if (!movieTitles.length) return [];

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
      { titles: movieTitles }
    );

      const moviesByTitle = new Map(result.records.map((record) => {

        const movie = {
          title: record.get("title"),
          year: record.get("year"),
          directors: record.get("directors"),
          actors: record.get("actors"),
          genres: record.get("genres"),
          themes: record.get("themes"),
        };

        return [movie.title, movie];
      })
    );

    return movieTitles.map((title) => moviesByTitle.get(title)).filter(Boolean);

  }

  finally {

    await session.close();
  }
}

function rankCandidates(candidates, vectorMatches, sourceMovie) {

  const matchesByTitle = new Map(vectorMatches.map((match) => [match.metadata?.title, match]).filter(([title]) => title)
  );

  const sourceGenres = sourceMovie?.genres || [];

  const sourceThemes = sourceMovie?.themes || [];

  return candidates
    .map((candidate) => {const vectorMatch = matchesByTitle.get(candidate.title);

      return {
        ...candidate,
        vectorScore: vectorMatch?.score || 0,
        embeddedText: vectorMatch?.metadata?.text || "",
        genreOverlap: candidate.genres.filter((genre) => sourceGenres.includes(genre)).length,
        themeOverlap: candidate.themes.filter((theme) => sourceThemes.includes(theme)).length,
      };
    }).sort((left, right) =>
        right.genreOverlap - left.genreOverlap ||
        right.themeOverlap - left.themeOverlap ||
        right.vectorScore - left.vectorScore
    );
}


async function answerSimilarityQuery(query, resolvedEntities) {

  const sourceMovieTitle = resolvedEntities.entities.find((entity) => entity.label === "Movie")?.nodeName || null;

  console.log(sourceMovieTitle? `Finding movies similar to "${sourceMovieTitle}"`: "No source movie was resolved. Using the full query for vector search."
  );

  const queryVector = await embedText(sourceMovieTitle || query);

  const searchResults = await pineconeIndex.query({
    vector: queryVector,
    topK: VECTOR_TOP_K,
    includeMetadata: true,
  });


  const vectorMatches = searchResults.matches || [];

  if (!vectorMatches.length) return "I could not find matching movies.";


  const candidateTitles = vectorMatches.map((match) => match.metadata?.title).filter((title) => title && title !== sourceMovieTitle);

  const titlesToFetch = sourceMovieTitle? [sourceMovieTitle, ...candidateTitles]: candidateTitles;

  const movieContexts = await getMovieContexts(titlesToFetch);

  const sourceMovie = sourceMovieTitle? movieContexts.find((movie) => movie.title === sourceMovieTitle) || null: null;

  const candidates = movieContexts.filter((movie) => movie.title !== sourceMovieTitle);

  if (!candidates.length) {return "I found vector matches, but I could not fetch their graph details from Neo4j.";
  }

  const topCandidates = rankCandidates(
    candidates,
    vectorMatches,
    sourceMovie
  ).slice(0, VECTOR_TOP_K);


  const recommendationCount = Math.min(
    FINAL_RECOMMENDATION_COUNT,
    topCandidates.length
  );

 const sourceDetails = sourceMovie? JSON.stringify(sourceMovie, null, 2): "No source movie was found.";

  const instructions = `Recommend up to ${recommendationCount} movies.
Use only the supplied candidates and never recommend the source movie itself.
Prefer movies with matching genres and themes, then consider semantic similarity.
Return a numbered list with one short reason per movie.
Do not mention databases, vectors, scores, or other implementation details.`;

const context = `Question:
${query}

Source movie:

${sourceDetails}

Candidate movies: ${JSON.stringify(topCandidates, null, 2)}`;

  const answer = await invokeLLM(instructions, context);
  return answer.trim();
}

export { answerSimilarityQuery };
