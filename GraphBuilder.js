import { driver } from "./Config.js";

async function saveMovieGraph(movieData) {

  const session = driver.session();

  try {
    await session.executeWrite(async (transaction) =>
      
      {
      await transaction.run(
        `MERGE (m:Movie {title: $title}) SET m.year = $year`,
        {
          title: movieData.movie.title,
          year: movieData.movie.year,
        }
      );

      if (movieData.director && movieData.director.name) {
        await transaction.run(
          `MERGE (d:Director {name: $name})
           MERGE (m:Movie {title: $title})
           MERGE (d)-[:DIRECTED]->(m)`,
          {
            name: movieData.director.name,
            title: movieData.movie.title,
          }
        );
      }

      if (movieData.actors) {

        for (const actorName of movieData.actors) {
          await transaction.run(
            `MERGE (a:Actor {name: $name})
             MERGE (m:Movie {title: $title})
             MERGE (a)-[:ACTED_IN]->(m)`,
            {
              name: actorName,
              title: movieData.movie.title,
            }
          );
        }
      }

      if (movieData.genres) {
        for (const genreName of movieData.genres) {
          await transaction.run(
            `MERGE (g:Genre {name: $name})
             MERGE (m:Movie {title: $title})
             MERGE (m)-[:BELONGS_TO]->(g)`,
            {
              name: genreName,
              title: movieData.movie.title,
            }
          );
        }
      }

      if (movieData.themes) {
        for (const themeName of movieData.themes) {
          await transaction.run(
            `MERGE (t:Theme {name: $name})
             MERGE (m:Movie {title: $title})
             MERGE (m)-[:EXPLORES]->(t)`,
            {
              name: themeName,
              title: movieData.movie.title,
            }
          );
        }
      }

      if (movieData.awards) {

        for (const awardName of movieData.awards) 
          
          {
          const awardParts = awardName.match(/^(.+?)\s*\((.+)\)$/);
          
          if (!awardParts) {
            continue;
          }

          await transaction.run(
            `MERGE (aw:Award {name: $awardType, category: $category})
             MERGE (m:Movie {title: $title})
             MERGE (m)-[:WON]->(aw)`,
            {
              awardType: awardParts.at(1).trim(),
              category: awardParts.at(2).trim(),
              title: movieData.movie.title,
            }
          );
        }
      }
    });
  } finally {
    await session.close();
  }
}

async function buildMovieGraph(movies) {
  console.log(`\nBuilding graph for ${movies.length} movies...\n`);

  const session = driver.session();

  try {
    
    await session.run("CREATE INDEX IF NOT EXISTS FOR (m:Movie) ON (m.title)");
    await session.run("CREATE INDEX IF NOT EXISTS FOR (d:Director) ON (d.name)");
    await session.run("CREATE INDEX IF NOT EXISTS FOR (a:Actor) ON (a.name)");
    await session.run("CREATE INDEX IF NOT EXISTS FOR (g:Genre) ON (g.name)");
    await session.run("CREATE INDEX IF NOT EXISTS FOR (t:Theme) ON (t.name)");
    await session.run(
      "CREATE INDEX IF NOT EXISTS FOR (aw:Award) ON (aw.name, aw.category)"
    );

    console.log("Indexes created.");
  } finally {
    await session.close();
  }

  for (let movieIndex = 0; movieIndex < movies.length; movieIndex++) {
    await saveMovieGraph(movies[movieIndex]);

    if ((movieIndex + 1) % 50 === 0 || movieIndex === movies.length - 1) {
      console.log(
        `Inserted ${movieIndex + 1}/${movies.length} movies into Neo4j`
      );
    }
  }
}

export { buildMovieGraph };