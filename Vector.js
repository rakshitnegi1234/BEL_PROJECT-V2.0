import { embedTexts, pineconeIndex } from "./Config.js";

function pause(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function makeEmbeddingText(movieData) {


  const parts = [
    `${movieData.movie.title} is a ${movieData.genres.join(", ")} movie released in ${movieData.movie.year}.`,
    `Directed by ${movieData.director.name}.`,
    `Starring ${movieData.actors.join(", ")}.`,
    `The movie explores themes of ${movieData.themes.join(", ")}.`,
  ];

  return parts.join(" ");
}




async function buildMovieVectors(movies) {

  const moviesToIndex = movies.slice(0, 200);

  console.log(`\nBuilding vector store for ${moviesToIndex.length} movies...\n`);

  const batchSize = 50;

  for (let startIndex = 0; startIndex < moviesToIndex.length; startIndex += batchSize)

    {

    const batchMovies = moviesToIndex.slice(startIndex, startIndex + batchSize);

    const batchNumber = Math.floor(startIndex / batchSize) + 1;

    console.log(`Embedding batch ${batchNumber}`);

    // geminir ate limit RPM
    if (startIndex > 0) {
      console.log("Waiting 15 seconds for Gemini Embedding API rate limits...");
      await pause(15000);
    }

     const movieTexts = batchMovies.map((movieData) => {
     return makeEmbeddingText(movieData);
  });

    const vectors = await embedTexts(movieTexts);

    const vectorRecords = batchMovies.map((movieData, movieIndex) => ({

      id: movieData.movie.title.replace(/\s+/g, "-").toLowerCase(),
      values: vectors[movieIndex],
      metadata: {
        title: movieData.movie.title,
        year: movieData.movie.year,
        director: movieData.director.name,
        genres: movieData.genres.join(", "),
        themes: movieData.themes.join(", "),
        actors: movieData.actors.join(", "),
        text: movieTexts[movieIndex],
      },
    }));

    await pineconeIndex.upsert({ records: vectorRecords });
  }


}

export { buildMovieVectors };
