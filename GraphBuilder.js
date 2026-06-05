import { driver } from "./Config.js";

async function insertMovieGraph(entity) {

  const session = driver.session();
  try {
    await session.executeWrite(async (tx) => {
      // Movie node
      await tx.run(
        `MERGE (m:Movie {title: $title}) SET m.year = $year`,
        { title: entity.movie.title, year: entity.movie.year }
      );

      // Director node + DIRECTED relationship
      if (entity.director && entity.director.name) {
          await tx.run(
            `MERGE (d:Director {name: $name})
             MERGE (m:Movie {title: $title})
             MERGE (d)-[:DIRECTED]->(m)`,
            { name: entity.director.name, title: entity.movie.title }
          );
      }

      // Actor nodes + ACTED_IN relationships
      for (const actorName of entity.actors || []) {
        await tx.run(
          `MERGE (a:Actor {name: $name})
           MERGE (m:Movie {title: $title})
           MERGE (a)-[:ACTED_IN]->(m)`,
          { name: actorName, title: entity.movie.title }
        );
      }

      // Genre nodes + BELONGS_TO relationships
      for (const genreName of entity.genres || []) {
        await tx.run(
          `MERGE (g:Genre {name: $name})
           MERGE (m:Movie {title: $title})
           MERGE (m)-[:BELONGS_TO]->(g)`,
          { name: genreName, title: entity.movie.title }
        );
      }

      // Theme nodes + EXPLORES relationships
      for (const themeName of entity.themes || []) {
        await tx.run(
          `MERGE (t:Theme {name: $name})
           MERGE (m:Movie {title: $title})
           MERGE (m)-[:EXPLORES]->(t)`,
          { name: themeName, title: entity.movie.title }
        );
      }
      
      // Award nodes + WON relationships
      // Matches "Oscar (Best Picture)" -> name: "Oscar", category: "Best Picture"
      for (const awardName of entity.awards || []) {
        const match = awardName.match(/^(.+?)\s*\((.+)\)$/);
        if (match) {
          await tx.run(
            `MERGE (aw:Award {name: $awardType, category: $category})
             MERGE (m:Movie {title: $title})
             MERGE (m)-[:WON]->(aw)`,
            {
              awardType: match[1].trim(),
              category: match[2].trim(),
              title: entity.movie.title,
            }
          );
        }
      }
    });
  } finally {
    await session.close();
  }
}

async function buildGraph(entities) {
  console.log(`\nBuilding graph for ${entities.length} movies...\n`);
  
  const session = driver.session();
  try {
    // Indexes speed up the MERGE operations significantly for ALL node types
    await session.run("CREATE INDEX IF NOT EXISTS FOR (m:Movie) ON (m.title)");
    await session.run("CREATE INDEX IF NOT EXISTS FOR (d:Director) ON (d.name)");
    await session.run("CREATE INDEX IF NOT EXISTS FOR (a:Actor) ON (a.name)");
    await session.run("CREATE INDEX IF NOT EXISTS FOR (g:Genre) ON (g.name)");
    await session.run("CREATE INDEX IF NOT EXISTS FOR (t:Theme) ON (t.name)");
    await session.run("CREATE INDEX IF NOT EXISTS FOR (aw:Award) ON (aw.name, aw.category)");
    console.log("📇 Indexes created.");
  } finally {
    await session.close();
  }

  for (let i = 0; i < entities.length; i++) {
    await insertMovieGraph(entities[i]);
    if ((i + 1) % 50 === 0 || i === entities.length - 1) {
      console.log(`   📊 Inserted ${i + 1}/${entities.length} movies into Neo4j`);
    }
  }
  
  // Print stats
  const statsSession = driver.session();
  try {
    const nodeCount = await statsSession.run("MATCH (n) RETURN count(n) AS count");
    const relCount = await statsSession.run("MATCH ()-[r]->() RETURN count(r) AS count");
    console.log(`✅ Graph built successfully!`);
    console.log(`   Nodes: ${nodeCount.records[0].get("count")}`);
    console.log(`   Relationships: ${relCount.records[0].get("count")}`);
  } finally {
    await statsSession.close();
  }
}

export { buildGraph };