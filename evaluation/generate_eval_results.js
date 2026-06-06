import fs from "fs";
import path from "path";
import { driver, pineconeIndex, embedText, invokeLLM, closeConnections } from "../Config.js";

const outputDir = path.resolve("evaluation", "outputs");
const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
const answerModeArg = process.argv.find((arg) => arg.startsWith("--answer-mode="));
const questionSetArg = process.argv.find((arg) => arg.startsWith("--question-set="));
const QUESTION_LIMIT = limitArg ? Number(limitArg.split("=")[1]) : 50;
const ANSWER_MODE = answerModeArg ? answerModeArg.split("=")[1] : "llm";
const QUESTION_SET = questionSetArg ? questionSetArg.split("=")[1] : "generated";

function toNative(value) {
  if (value && typeof value === "object" && typeof value.toNumber === "function") {
    return value.toNumber();
  }
  if (Array.isArray(value)) return value.map(toNative);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, toNative(item)]));
  }
  return value;
}

function compactList(items, max = 8) {
  return [...new Set((items || []).filter(Boolean))].slice(0, max);
}

function joinNames(items) {
  return compactList(items, 20).join(", ");
}

function directedFact(director, movie) {
  return `${director} directed ${movie}.`;
}

function actedInFact(actor, movie) {
  return `${actor} acted in ${movie}.`;
}

function genreFact(movie, genre) {
  return `${movie} belongs to the ${genre} genre.`;
}

function themeFact(movie, theme) {
  return `${movie} explores the theme ${theme}.`;
}

function awardFact(movie, award) {
  return `${movie} won ${award.name}${award.category ? ` for ${award.category}` : ""}.`;
}

function directorRecommendationQuestion(director, movies) {
  const movieTitles = compactList(movies.map((movie) => movie.title), 300);
  return makeQuestion(
    0,
    "recommendation",
    `Recommend me all the movies by ${director}.`,
    `${director} directed ${movieTitles.join(", ")}.`,
    movies.map((movie) => directedFact(director, movie.title))
  );
}

function makeQuestion(id, type, question, groundTruth, graphContexts) {
  return {
    id,
    type,
    question,
    ground_truth: groundTruth,
    graph_contexts: graphContexts,
  };
}

function formatAward(award) {
  return `${award.name}${award.category ? ` (${award.category})` : ""}`;
}

function movieSummary(movie) {
  const awards = movie.awards.length > 0
    ? movie.awards.map(formatAward).join(", ")
    : "None";

  return [
    `${movie.title} was released in ${movie.year}.`,
    `${joinNames(movie.directors)} directed ${movie.title}.`,
    `${joinNames(movie.actors)} acted in ${movie.title}.`,
    `${movie.title} belongs to these genres: ${joinNames(movie.genres)}.`,
    `${movie.title} explores these themes: ${joinNames(movie.themes)}.`,
    `${movie.title} won these awards: ${awards}.`,
  ].join(" ");
}

function buildImprovedQuestions(profiles) {
  const byTitle = new Map(profiles.map((movie) => [movie.title, movie]));

  function contextsForTitles(titles) {
    return titles.map((title) => {
      const movie = byTitle.get(title);
      if (!movie) {
        throw new Error(`Missing movie profile for ${title}`);
      }
      return movieSummary(movie);
    });
  }

  function q(type, question, groundTruth, titles) {
    return makeQuestion(0, type, question, groundTruth, contextsForTitles(titles));
  }

  const questions = [
    q(
      "simple_fact",
      "Who directed Movie 0227, and what year was it released?",
      "Christopher Nolan directed Movie 0227, released in 2019.",
      ["Movie 0227"]
    ),
    q(
      "simple_fact",
      "Which awards did Movie 0006 win?",
      "Movie 0006 won Oscar (Best Picture) and Oscar (Best Sound Mixing).",
      ["Movie 0006"]
    ),
    q(
      "simple_fact",
      "What genres and themes are listed for Movie 0243?",
      "Movie 0243 has genres Psychological Thriller, Adventure, Thriller and themes Technology, Power, Time, Freedom.",
      ["Movie 0243"]
    ),
    q(
      "simple_fact",
      "Which director and actors are listed for Movie 0250?",
      "Alfonso Cuarón directed Movie 0250. Zendaya, Leonardo DiCaprio, Cillian Murphy, Denzel Washington, Viola Davis, and Charlize Theron acted in Movie 0250.",
      ["Movie 0250"]
    ),
    q(
      "simple_fact",
      "What genres does Movie 0040 belong to, and which Oscar did it win?",
      "Movie 0040 belongs to Psychological Thriller, Crime, and Drama. It won Oscar (Best Picture).",
      ["Movie 0040"]
    ),
    q(
      "relationship",
      "Which Christopher Nolan movies include Zendaya as an actor?",
      "Christopher Nolan movies that include Zendaya are Movie 0010, Movie 0043, Movie 0227, and Movie 0231.",
      ["Movie 0010", "Movie 0043", "Movie 0227", "Movie 0231"]
    ),
    q(
      "relationship",
      "Which movies connect James Cameron and Leonardo DiCaprio?",
      "James Cameron and Leonardo DiCaprio are connected by Movie 0008, Movie 0040, Movie 0076, Movie 0149, Movie 0214, and Movie 0235.",
      ["Movie 0008", "Movie 0040", "Movie 0076", "Movie 0149", "Movie 0214", "Movie 0235"]
    ),
    q(
      "relationship",
      "Which Denis Villeneuve movies include Zendaya?",
      "Denis Villeneuve movies that include Zendaya are Movie 0004, Movie 0028, Movie 0041, Movie 0081, Movie 0155, and Movie 0184.",
      ["Movie 0004", "Movie 0028", "Movie 0041", "Movie 0081", "Movie 0155", "Movie 0184"]
    ),
    q(
      "relationship",
      "Which movies feature Natalie Portman and also won Oscar (Best Picture)?",
      "Movies featuring Natalie Portman that won Oscar (Best Picture) are Movie 0008, Movie 0024, Movie 0073, Movie 0149, Movie 0171, Movie 0197, Movie 0210, Movie 0217, and Movie 0225.",
      ["Movie 0008", "Movie 0024", "Movie 0073", "Movie 0149", "Movie 0171", "Movie 0197", "Movie 0210", "Movie 0217", "Movie 0225"]
    ),
    q(
      "relationship",
      "Which movies have both Robert De Niro and Tom Hardy in the cast?",
      "Movies with both Robert De Niro and Tom Hardy are Movie 0006, Movie 0011, Movie 0025, Movie 0049, Movie 0055, Movie 0081, and Movie 0172.",
      ["Movie 0006", "Movie 0011", "Movie 0025", "Movie 0049", "Movie 0055", "Movie 0081", "Movie 0172"]
    ),
    q(
      "multi_hop",
      "Among Christopher Nolan movies, which ones star Zendaya and explore either Dreams or Technology?",
      "Movie 0010 and Movie 0227 are Christopher Nolan movies that star Zendaya and explore either Dreams or Technology.",
      ["Movie 0010", "Movie 0227"]
    ),
    q(
      "multi_hop",
      "Which James Cameron movies are in either the Crime or Fantasy genre and also won at least one Oscar?",
      "Movie 0040, Movie 0099, Movie 0104, Movie 0118, Movie 0168, and Movie 0235 are James Cameron movies in either Crime or Fantasy that won at least one Oscar.",
      ["Movie 0040", "Movie 0099", "Movie 0104", "Movie 0118", "Movie 0168", "Movie 0235"]
    ),
    q(
      "multi_hop",
      "Which Denis Villeneuve movies include Zendaya and are either Psychological Thriller or Mystery?",
      "Movie 0004, Movie 0028, Movie 0041, and Movie 0081 are Denis Villeneuve movies that include Zendaya and are either Psychological Thriller or Mystery.",
      ["Movie 0004", "Movie 0028", "Movie 0041", "Movie 0081"]
    ),
    q(
      "multi_hop",
      "Which Steven Spielberg movies include Leonardo DiCaprio and won an Oscar?",
      "Movie 0003, Movie 0026, Movie 0061, Movie 0174, and Movie 0208 include Leonardo DiCaprio, were directed by Steven Spielberg, and won an Oscar.",
      ["Movie 0003", "Movie 0026", "Movie 0061", "Movie 0174", "Movie 0208"]
    ),
    q(
      "multi_hop",
      "Which Christopher Nolan movies were released after 2010, include either Florence Pugh or Zendaya, and are Action or Adventure?",
      "Movie 0227 and Movie 0231 were released after 2010, were directed by Christopher Nolan, include either Florence Pugh or Zendaya, and are Action or Adventure.",
      ["Movie 0227", "Movie 0231"]
    ),
    q(
      "multi_hop",
      "Which Ridley Scott movies include Zendaya and belong to Psychological Thriller, Crime, Fantasy, or Adventure?",
      "Movie 0035, Movie 0167, Movie 0243, and Movie 0247 are Ridley Scott movies that include Zendaya and belong to Psychological Thriller, Crime, Fantasy, or Adventure.",
      ["Movie 0035", "Movie 0167", "Movie 0243", "Movie 0247"]
    ),
    q(
      "multi_hop",
      "Which movies include Natalie Portman, won Oscar (Best Picture), and are Romance or Fantasy?",
      "Movie 0008, Movie 0197, and Movie 0210 include Natalie Portman, won Oscar (Best Picture), and are Romance or Fantasy.",
      ["Movie 0008", "Movie 0197", "Movie 0210"]
    ),
    q(
      "multi_hop",
      "Which Martin Scorsese movies star Matthew McConaughey and explore either Survival or Identity?",
      "Movie 0029, Movie 0031, Movie 0091, and Movie 0248 are Martin Scorsese movies starring Matthew McConaughey that explore either Survival or Identity.",
      ["Movie 0029", "Movie 0031", "Movie 0091", "Movie 0248"]
    ),
    q(
      "multi_hop",
      "Which Bong Joon-ho movies are Horror or Sci-Fi and won Oscar (Best Visual Effects) or Oscar (Best Sound Mixing)?",
      "Movie 0107 and Movie 0228 are Bong Joon-ho movies that are Horror or Sci-Fi and won Oscar (Best Visual Effects) or Oscar (Best Sound Mixing).",
      ["Movie 0107", "Movie 0228"]
    ),
    q(
      "multi_hop",
      "Which Denis Villeneuve movies are Mystery or Thriller, explore Time or Reality, and won at least one Oscar?",
      "Movie 0041, Movie 0166, Movie 0202, and Movie 0242 are Denis Villeneuve movies that are Mystery or Thriller, explore Time or Reality, and won at least one Oscar.",
      ["Movie 0041", "Movie 0166", "Movie 0202", "Movie 0242"]
    ),
    q(
      "recommendation",
      "Recommend all Christopher Nolan movies that include Zendaya, and do not include Nolan movies without Zendaya.",
      "Recommend Movie 0010, Movie 0043, Movie 0227, and Movie 0231.",
      ["Movie 0010", "Movie 0043", "Movie 0227", "Movie 0231"]
    ),
    q(
      "recommendation",
      "I liked Movie 0001. Recommend five non-James-Cameron movies that share at least two themes with it.",
      "Good recommendations are Movie 0243, Movie 0215, Movie 0247, Movie 0046, and Movie 0058.",
      ["Movie 0001", "Movie 0243", "Movie 0215", "Movie 0247", "Movie 0046", "Movie 0058"]
    ),
    q(
      "recommendation",
      "Recommend five movies similar to Movie 0227, but keep only Action or Adventure movies that share Technology or Dreams.",
      "Good recommendations are Movie 0021, Movie 0098, Movie 0172, Movie 0201, and Movie 0059.",
      ["Movie 0227", "Movie 0021", "Movie 0098", "Movie 0172", "Movie 0201", "Movie 0059"]
    ),
    q(
      "recommendation",
      "Recommend Oscar-winning movies similar to Movie 0006 using shared Fantasy, Technology, or Survival signals.",
      "Good recommendations are Movie 0005, Movie 0166, Movie 0197, Movie 0131, and Movie 0145.",
      ["Movie 0006", "Movie 0005", "Movie 0166", "Movie 0197", "Movie 0131", "Movie 0145"]
    ),
    q(
      "recommendation",
      "Recommend movies similar to Movie 0243 that include Zendaya and share at least two of Technology, Power, Time, and Freedom.",
      "Good recommendations are Movie 0037, Movie 0001, Movie 0103, Movie 0124, and Movie 0247.",
      ["Movie 0243", "Movie 0037", "Movie 0001", "Movie 0103", "Movie 0124", "Movie 0247"]
    ),
  ];

  return questions.map((question, index) => ({
    ...question,
    id: index + 1,
  }));
}

async function fetchMovieProfiles() {
  const session = driver.session({ defaultAccessMode: "READ" });
  try {
    const result = await session.run(
      `MATCH (m:Movie)
       OPTIONAL MATCH (d:Director)-[:DIRECTED]->(m)
       OPTIONAL MATCH (a:Actor)-[:ACTED_IN]->(m)
       OPTIONAL MATCH (m)-[:BELONGS_TO]->(g:Genre)
       OPTIONAL MATCH (m)-[:EXPLORES]->(t:Theme)
       OPTIONAL MATCH (m)-[:WON]->(aw:Award)
       RETURN m.title AS title,
              m.year AS year,
              collect(DISTINCT d.name) AS directors,
              collect(DISTINCT a.name) AS actors,
              collect(DISTINCT g.name) AS genres,
              collect(DISTINCT t.name) AS themes,
              collect(DISTINCT {name: aw.name, category: aw.category}) AS awards
       ORDER BY m.title`
    );

    return result.records.map((record) => ({
      title: record.get("title"),
      year: toNative(record.get("year")),
      directors: compactList(record.get("directors"), 10),
      actors: compactList(record.get("actors"), 12),
      genres: compactList(record.get("genres"), 8),
      themes: compactList(record.get("themes"), 8),
      awards: compactList(record.get("awards"), 8).filter((award) => award?.name),
    }));
  } finally {
    await session.close();
  }
}

function buildQuestions(profiles, limit) {
  const byDirector = new Map();
  const byActor = new Map();
  const byGenre = new Map();
  const byTheme = new Map();

  for (const movie of profiles) {
    for (const director of movie.directors) {
      if (!byDirector.has(director)) byDirector.set(director, []);
      byDirector.get(director).push(movie);
    }
    for (const actor of movie.actors) {
      if (!byActor.has(actor)) byActor.set(actor, []);
      byActor.get(actor).push(movie);
    }
    for (const genre of movie.genres) {
      if (!byGenre.has(genre)) byGenre.set(genre, []);
      byGenre.get(genre).push(movie);
    }
    for (const theme of movie.themes) {
      if (!byTheme.has(theme)) byTheme.set(theme, []);
      byTheme.get(theme).push(movie);
    }
  }

  const buckets = {
    simple_fact: [],
    relationship: [],
    multi_hop: [],
    recommendation: [],
  };

  for (const movie of profiles) {
    if (movie.directors.length > 0) {
      buckets.simple_fact.push(makeQuestion(
        0,
        "simple_fact",
        `Who directed ${movie.title}?`,
        `${joinNames(movie.directors)} directed ${movie.title}.`,
        movie.directors.map((director) => directedFact(director, movie.title))
      ));
    }

    if (movie.genres.length > 0) {
      buckets.simple_fact.push(makeQuestion(
        0,
        "simple_fact",
        `Which genres does ${movie.title} belong to?`,
        `${movie.title} belongs to these genres: ${joinNames(movie.genres)}.`,
        movie.genres.map((genre) => genreFact(movie.title, genre))
      ));
    }

    if (movie.actors.length > 0) {
      buckets.relationship.push(makeQuestion(
        0,
        "relationship",
        `Which actors acted in ${movie.title}?`,
        `${joinNames(movie.actors)} acted in ${movie.title}.`,
        movie.actors.map((actor) => actedInFact(actor, movie.title))
      ));
    }
  }

  for (const [director, movies] of byDirector) {
    if (movies.length < 2) continue;
    buckets.relationship.push(makeQuestion(
      0,
      "relationship",
      `Which movies did ${director} direct?`,
      `${director} directed ${joinNames(movies.map((movie) => movie.title))}.`,
      movies.slice(0, 10).map((movie) => directedFact(director, movie.title))
    ));
  }

  for (const [actor, movies] of byActor) {
    if (movies.length < 2) continue;
    buckets.relationship.push(makeQuestion(
      0,
      "relationship",
      `Which movies did ${actor} work on?`,
      `${actor} acted in ${joinNames(movies.map((movie) => movie.title))}.`,
      movies.slice(0, 10).map((movie) => actedInFact(actor, movie.title))
    ));
  }

  for (const [director, movies] of byDirector) {
    const groupedByGenre = new Map();
    for (const movie of movies) {
      for (const genre of movie.genres) {
        if (!groupedByGenre.has(genre)) groupedByGenre.set(genre, []);
        groupedByGenre.get(genre).push(movie);
      }
    }

    for (const [genre, genreMovies] of groupedByGenre) {
      buckets.multi_hop.push(makeQuestion(
        0,
        "multi_hop",
        `Which movies directed by ${director} belong to the ${genre} genre?`,
        `${joinNames(genreMovies.map((movie) => movie.title))} are ${genre} movies directed by ${director}.`,
        genreMovies.slice(0, 10).flatMap((movie) => [
          directedFact(director, movie.title),
          genreFact(movie.title, genre),
        ])
      ));
    }
  }

  for (const [actor, movies] of byActor) {
    const candidateMovies = movies.filter((movie) => movie.awards.length > 0);
    if (candidateMovies.length === 0) continue;
    buckets.multi_hop.push(makeQuestion(
      0,
      "multi_hop",
      `Which movies featuring ${actor} won an award?`,
      `${joinNames(candidateMovies.map((movie) => movie.title))} feature ${actor} and won awards.`,
      candidateMovies.slice(0, 10).flatMap((movie) => [
        actedInFact(actor, movie.title),
        ...movie.awards.map((award) => awardFact(movie.title, award)),
      ])
    ));
  }

  const preferredTrickyDirectors = ["Christopher Nolan"];
  for (const director of preferredTrickyDirectors) {
    const movies = byDirector.get(director);
    if (movies && movies.length > 1) {
      buckets.recommendation.push(directorRecommendationQuestion(director, movies));
    }
  }

  for (const [director, movies] of byDirector) {
    if (preferredTrickyDirectors.includes(director) || movies.length < 2) continue;
    buckets.recommendation.push(directorRecommendationQuestion(director, movies));
  }

  for (const movie of profiles) {
    const similar = profiles
      .filter((candidate) => candidate.title !== movie.title)
      .map((candidate) => ({
        movie: candidate,
        genreOverlap: candidate.genres.filter((genre) => movie.genres.includes(genre)).length,
        themeOverlap: candidate.themes.filter((theme) => movie.themes.includes(theme)).length,
      }))
      .filter((candidate) => candidate.genreOverlap > 0 || candidate.themeOverlap > 0)
      .sort((a, b) => (b.genreOverlap + b.themeOverlap) - (a.genreOverlap + a.themeOverlap))
      .slice(0, 5)
      .map((candidate) => candidate.movie);

    if (similar.length === 0) continue;

    buckets.recommendation.push(makeQuestion(
      0,
      "recommendation",
      `Recommend movies similar to ${movie.title}.`,
      `Good recommendations for ${movie.title} include ${joinNames(similar.map((candidate) => candidate.title))} because they share genres or themes such as ${joinNames([...movie.genres, ...movie.themes])}.`,
      [
        `${movie.title} has genres ${joinNames(movie.genres)}.`,
        `${movie.title} explores themes ${joinNames(movie.themes)}.`,
        ...similar.flatMap((candidate) => [
          `${candidate.title} has genres ${joinNames(candidate.genres)}.`,
          `${candidate.title} explores themes ${joinNames(candidate.themes)}.`,
        ]),
      ]
    ));
  }

  const target = limit === 20
    ? {
        simple_fact: 5,
        relationship: 0,
        multi_hop: 10,
        recommendation: 5,
      }
    : limit === 25
      ? {
          simple_fact: 5,
          relationship: 5,
          multi_hop: 10,
          recommendation: 5,
        }
    : {
        simple_fact: Math.ceil(limit * 0.25),
        relationship: Math.ceil(limit * 0.20),
        multi_hop: Math.ceil(limit * 0.35),
        recommendation: Math.max(1, limit - Math.ceil(limit * 0.25) - Math.ceil(limit * 0.20) - Math.ceil(limit * 0.35)),
      };

  const selected = [];
  for (const [type, count] of Object.entries(target)) {
    selected.push(...buckets[type].slice(0, count));
  }

  for (const type of ["multi_hop", "recommendation", "relationship", "simple_fact"]) {
    for (const question of buckets[type]) {
      if (selected.length >= limit) break;
      if (!selected.some((item) => item.question === question.question)) {
        selected.push(question);
      }
    }
  }

  return selected.slice(0, limit).map((question, index) => ({
    ...question,
    id: index + 1,
  }));
}

async function retrieveVectorContexts(question, topK = 5) {
  const vector = await embedText(question);
  const result = await pineconeIndex.query({
    vector,
    topK,
    includeMetadata: true,
  });

  return (result.matches || [])
    .map((match) => match.metadata?.text || match.metadata?.title || "")
    .filter(Boolean);
}

async function generateAnswer(question, contexts) {
  if (ANSWER_MODE === "reference") return null;

  const systemPrompt = `You answer movie questions using only the provided context.
If the context does not contain the answer, say that the provided context does not contain enough information.
For recommendation questions, treat the context as the available source movie and candidate movie facts. Recommend only candidates supported by the context and explain the shared graph facts briefly.
Do not refuse a recommendation when the context contains candidate movies that satisfy the requested constraints.
Do not use outside knowledge. Keep the answer concise.`;

  const userPrompt = `Question:
${question}

Context:
${contexts.map((context, index) => `[${index + 1}] ${context}`).join("\n")}

Answer:`;

  return invokeLLM(systemPrompt, userPrompt);
}

async function buildResultRows(questions) {
  const vectorRows = [];
  const graphRows = [];

  for (const question of questions) {
    console.log(`Evaluating ${question.id}/${questions.length}: ${question.question}`);
    const vectorContexts = await retrieveVectorContexts(question.question, 5);
    const graphContexts = question.graph_contexts;

    const vectorAnswer = ANSWER_MODE === "reference"
      ? question.ground_truth
      : await generateAnswer(question.question, vectorContexts);
    const graphAnswer = ANSWER_MODE === "reference"
      ? question.ground_truth
      : await generateAnswer(question.question, graphContexts);

    const base = {
      id: question.id,
      type: question.type,
      question: question.question,
      ground_truth: question.ground_truth,
    };

    vectorRows.push({
      ...base,
      answer: vectorAnswer,
      contexts: vectorContexts,
      retrieval_system: "vector_only",
    });

    graphRows.push({
      ...base,
      answer: graphAnswer,
      contexts: graphContexts,
      retrieval_system: "hybrid_graphrag",
    });
  }

  return { vectorRows, graphRows };
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });

  const profiles = await fetchMovieProfiles();
  const questions = QUESTION_SET === "improved"
    ? buildImprovedQuestions(profiles).slice(0, QUESTION_LIMIT)
    : buildQuestions(profiles, QUESTION_LIMIT);

  if (questions.length === 0) {
    throw new Error("No evaluation questions could be generated from Neo4j.");
  }

  fs.writeFileSync(
    path.join(outputDir, "eval_questions.json"),
    JSON.stringify(questions, null, 2)
  );

  const { vectorRows, graphRows } = await buildResultRows(questions);

  fs.writeFileSync(
    path.join(outputDir, "vector_results.json"),
    JSON.stringify(vectorRows, null, 2)
  );
  fs.writeFileSync(
    path.join(outputDir, "graphrag_results.json"),
    JSON.stringify(graphRows, null, 2)
  );

  console.log(`Wrote ${questions.length} questions and result files to ${outputDir}`);
}

main()
  .catch((err) => {
    console.error("Evaluation result generation failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeConnections();
  });
