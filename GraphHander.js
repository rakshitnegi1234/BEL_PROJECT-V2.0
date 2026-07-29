import { driver, invokeLLM } from "./Config.js";

const LABEL_CONFIG = {
  Movie: { variable: "m", key: "title" },
  Director: { variable: "d", key: "name" },
  Actor: { variable: "a", key: "name" },
  Genre: { variable: "g", key: "name" },
  Theme: { variable: "t", key: "name" },
  Award: { variable: "aw", key: "name" },
};

const RELATIONSHIP_PATTERNS = {
  "Director:DIRECTED:Movie": "(d:Director)-[:DIRECTED]->(m:Movie)",
  "Actor:ACTED_IN:Movie": "(a:Actor)-[:ACTED_IN]->(m:Movie)",
  "Movie:BELONGS_TO:Genre": "(m:Movie)-[:BELONGS_TO]->(g:Genre)",
  "Movie:EXPLORES:Theme": "(m:Movie)-[:EXPLORES]->(t:Theme)",
  "Movie:WON:Award": "(m:Movie)-[:WON]->(aw:Award)",
};

const ALLOWED_OPERATORS = new Set([
  "=",
  "<>",
  ">",
  "<",
  ">=",
  "<=",
  "CONTAINS",
  "STARTS WITH",
]);

function cleanModelJson(modelText) {
  return modelText.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
}

function checkLabel(label) {
  if (!LABEL_CONFIG[label]) {
    throw new Error(`Unsupported label in query plan: ${label}`);
  }
}

function getAllowedProperties(label) {
  if (label === "Movie") {
    return ["title", "year"];
  }
  if (label === "Award") {
    return ["name", "category"];
  }
  return ["name"];
}

function makeFieldExpression(field) {
  const [label, property] = field.split(".");
  checkLabel(label);

  const allowedProperties = getAllowedProperties(label);
  if (!allowedProperties.includes(property)) {
    throw new Error(`Unsupported field in query plan: ${field}`);
  }

  return `${LABEL_CONFIG[label].variable}.${property}`;
}

function toPlainValue(value) {
  if (value && typeof value === "object" && typeof value.toNumber === "function") {
    return value.toNumber();
  }
  if (Array.isArray(value)) {
    return value.map((item) => toPlainValue(item));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, toPlainValue(item)])
    );
  }
  return value;
}

function recordsToRows(queryResult) {
  return queryResult.records.map((record) => {
    const row = {};
    record.keys.forEach((fieldName) => {
      row[fieldName] = toPlainValue(record.get(fieldName));
    });
    return row;
  });
}

function getTraversalPattern(step) {
  checkLabel(step.from);
  checkLabel(step.to);

  const patternKey = `${step.from}:${step.rel}:${step.to}`;
  const directPattern = RELATIONSHIP_PATTERNS[patternKey];
  if (directPattern) {
    return directPattern;
  }

  const reverseKey = `${step.to}:${step.rel}:${step.from}`;
  const reversePattern = RELATIONSHIP_PATTERNS[reverseKey];
  if (reversePattern) {
    return reversePattern;
  }

  throw new Error(`Unsupported traversal in query plan: ${patternKey}`);
}

function buildWhereClause(whereClauses) {
  if (whereClauses.length === 0) {
    return "";
  }

  return `WHERE ${whereClauses.join(" AND ")}`;
}

function buildReadCypher(plan) {
  if (!plan?.steps || !Array.isArray(plan.steps)) {
    throw new Error("Query plan must contain a steps array.");
  }

  const matchPatterns = [];
  const whereClauses = [];
  const queryParams = {};
  let returnClause = null;
  let orderClause = "";
  let limitClause = "LIMIT 10";
  let nextParamNumber = 0;

  for (const step of plan.steps) {
    // The LLM can only choose from these known step types; each one is validated here.
    if (step.type === "traversal") {
      const pattern = getTraversalPattern(step);
      if (!matchPatterns.includes(pattern)) {
        matchPatterns.push(pattern);
      }
    }

    if (step.type === "filter") {
      if (!ALLOWED_OPERATORS.has(step.op)) {
        throw new Error(`Unsupported filter operator: ${step.op}`);
      }

      const fieldExpression = makeFieldExpression(step.field);
      const paramKey = `p${nextParamNumber++}`;
      queryParams[paramKey] = step.value;

      if (step.op === "CONTAINS" || step.op === "STARTS WITH") {
        whereClauses.push(`toLower(${fieldExpression}) ${step.op} toLower($${paramKey})`);
      } else {
        whereClauses.push(`${fieldExpression} ${step.op} $${paramKey}`);
      }
    }

    if (step.type === "projection") {
      const fields = step.fields.map((field) => {
        const fieldExpression = makeFieldExpression(field);
        const fieldAlias = field.replace(".", "_");
        return `${fieldExpression} AS ${fieldAlias}`;
      });

      let distinctText = "";
      if (step.distinct) {
        distinctText = "DISTINCT ";
      }

      returnClause = `RETURN ${distinctText}${fields.join(", ")}`;
    }

    if (step.type === "aggregation") {
      const fieldExpression = makeFieldExpression(step.field);
      const countAlias = step.alias || "count";
      if (step.groupBy) {
        const groupExpression = makeFieldExpression(step.groupBy);
        const groupAlias = step.groupBy.replace(".", "_");
        returnClause = `RETURN ${groupExpression} AS ${groupAlias}, count(DISTINCT ${fieldExpression}) AS ${countAlias}`;
      } else {
        returnClause = `RETURN count(DISTINCT ${fieldExpression}) AS ${countAlias}`;
      }
      limitClause = "";
    }

    if (step.type === "sort") {
      const fieldExpression = makeFieldExpression(step.field);
      let direction = "ASC";
      if (step.direction === "DESC") {
        direction = "DESC";
      }

      orderClause = `ORDER BY ${fieldExpression} ${direction}`;
    }

    if (step.type === "limit") {
      const limitValue = Number(step.value);
      if (Number.isInteger(limitValue) && limitValue > 0) {
        limitClause = `LIMIT ${Math.min(limitValue, 10)}`;
      }
    }
  }

  // A bare movie match lets simple projection/filter plans run without a traversal.
  if (matchPatterns.length === 0) {
    matchPatterns.push("(m:Movie)");
  }

  if (!returnClause) {
    returnClause = "RETURN DISTINCT m.title AS Movie_title, m.year AS Movie_year";
  }

  const cypherQuery = [
    `MATCH ${matchPatterns.join(", ")}`,
    buildWhereClause(whereClauses),
    returnClause,
    orderClause,
    limitClause,
  ]
    .filter(Boolean)
    .join("\n");

  return { cypher: cypherQuery, params: queryParams };
}

async function makeQueryPlan(query, resolvedEntities) {
  let entityContext = "No entities were resolved.";
  if (resolvedEntities.entities.length > 0) {
    entityContext = resolvedEntities.entities
      .map((entity) => `"${entity.searchTerm}" = ${entity.label} with database name "${entity.nodeName}"`)
      .join("\n");
  }

  let unresolvedContext = "";
  if (resolvedEntities.unresolved.length > 0) {
    unresolvedContext = `\nUnresolved terms: ${resolvedEntities.unresolved.join(", ")}`;
  }

  const systemPrompt = `You are a query planner for this movie Neo4j graph.

Resolved entities:
${entityContext}${unresolvedContext}

Schema:
Movie(title, year)
Director(name)
Actor(name)
Genre(name)
Theme(name)
Award(name, category)

Relationships:
Director-[:DIRECTED]->Movie
Actor-[:ACTED_IN]->Movie
Movie-[:BELONGS_TO]->Genre
Movie-[:EXPLORES]->Theme
Movie-[:WON]->Award

Return only JSON with a "steps" array.
Allowed steps:
{"type":"traversal","from":"Director","rel":"DIRECTED","to":"Movie"}
{"type":"traversal","from":"Actor","rel":"ACTED_IN","to":"Movie"}
{"type":"traversal","from":"Movie","rel":"BELONGS_TO","to":"Genre"}
{"type":"traversal","from":"Movie","rel":"EXPLORES","to":"Theme"}
{"type":"traversal","from":"Movie","rel":"WON","to":"Award"}
{"type":"filter","field":"Label.property","op":"=","value":"exact value"}
{"type":"projection","fields":["Movie.title","Movie.year"],"distinct":true}
{"type":"aggregation","function":"count","field":"Movie.title","alias":"total"}
{"type":"sort","field":"Movie.year","direction":"DESC"}
{"type":"limit","value":10}
{"type":"describe","label":"Movie","name":"exact database name"}
{"type":"path","fromLabel":"Actor","fromName":"exact database name","toLabel":"Director","toName":"exact database name"}

Rules:
- Use exact database names from resolved entities.
- Use describe for "tell me about X" or "who is X".
- Use path for "how is X related to Y".
- Use graph traversals for factual list/count/filter questions.
- For list questions, include limit 10 unless the user asks for a smaller number.
- Return only JSON. No markdown.`;

  const modelText = await invokeLLM(systemPrompt, query);
  try {
    return JSON.parse(cleanModelJson(modelText));
  } catch (error) {
    // Show a small part of the bad response for debugging without flooding the CLI.
    console.error("Failed to parse query plan:", modelText.substring(0, 300));
    throw new Error("Query planning failed. Please rephrase your question.");
  }
}

async function runDescribeQuery(label, name) {
  checkLabel(label);
  const session = driver.session({ defaultAccessMode: "READ" });

  try {
    let cypherQuery;

    switch (label) {
      case "Movie":
        cypherQuery = `
          MATCH (m:Movie {title: $name})
          OPTIONAL MATCH (d:Director)-[:DIRECTED]->(m)
          OPTIONAL MATCH (a:Actor)-[:ACTED_IN]->(m)
          OPTIONAL MATCH (m)-[:BELONGS_TO]->(g:Genre)
          OPTIONAL MATCH (m)-[:EXPLORES]->(t:Theme)
          OPTIONAL MATCH (m)-[:WON]->(aw:Award)
          RETURN m.title AS title, m.year AS year,
                 collect(DISTINCT d.name) AS directors,
                 collect(DISTINCT a.name) AS actors,
                 collect(DISTINCT g.name) AS genres,
                 collect(DISTINCT t.name) AS themes,
                 collect(DISTINCT {name: aw.name, category: aw.category}) AS awards`;
        break;
      case "Director":
        cypherQuery = `
          MATCH (d:Director {name: $name})-[:DIRECTED]->(m:Movie)
          OPTIONAL MATCH (m)-[:BELONGS_TO]->(g:Genre)
          OPTIONAL MATCH (m)-[:EXPLORES]->(t:Theme)
          OPTIONAL MATCH (a:Actor)-[:ACTED_IN]->(m)
          RETURN d.name AS name,
                 collect(DISTINCT {title: m.title, year: m.year}) AS movies,
                 collect(DISTINCT g.name) AS genres,
                 collect(DISTINCT t.name) AS themes,
                 collect(DISTINCT a.name) AS collaborators`;
        break;
      case "Actor":
        cypherQuery = `
          MATCH (a:Actor {name: $name})-[:ACTED_IN]->(m:Movie)
          OPTIONAL MATCH (d:Director)-[:DIRECTED]->(m)
          OPTIONAL MATCH (m)-[:BELONGS_TO]->(g:Genre)
          OPTIONAL MATCH (m)-[:EXPLORES]->(t:Theme)
          RETURN a.name AS name,
                 collect(DISTINCT {title: m.title, year: m.year}) AS movies,
                 collect(DISTINCT d.name) AS directors,
                 collect(DISTINCT g.name) AS genres,
                 collect(DISTINCT t.name) AS themes`;
        break;
      case "Genre":
        cypherQuery = `
          MATCH (m:Movie)-[:BELONGS_TO]->(g:Genre {name: $name})
          OPTIONAL MATCH (d:Director)-[:DIRECTED]->(m)
          RETURN g.name AS name,
                 collect(DISTINCT {title: m.title, year: m.year})[..10] AS movies,
                 collect(DISTINCT d.name) AS directors`;
        break;
      case "Theme":
        cypherQuery = `
          MATCH (m:Movie)-[:EXPLORES]->(t:Theme {name: $name})
          OPTIONAL MATCH (d:Director)-[:DIRECTED]->(m)
          RETURN t.name AS name,
                 collect(DISTINCT {title: m.title, year: m.year})[..10] AS movies,
                 collect(DISTINCT d.name) AS directors`;
        break;
      case "Award":
        cypherQuery = `
          MATCH (m:Movie)-[:WON]->(aw:Award {name: $name})
          OPTIONAL MATCH (d:Director)-[:DIRECTED]->(m)
          RETURN aw.name AS name,
                 collect(DISTINCT {title: m.title, year: m.year, category: aw.category})[..10] AS movies,
                 collect(DISTINCT d.name) AS directors`;
        break;
    }

    console.log(`Describe Cypher: ${cypherQuery.replace(/\s+/g, " ").trim()}`);
    const queryResult = await session.run(cypherQuery, { name });
    return recordsToRows(queryResult);
  } finally {
    await session.close();
  }
}

async function runPathQuery(fromLabel, fromName, toLabel, toName) {
  checkLabel(fromLabel);
  checkLabel(toLabel);

  const fromProperty = LABEL_CONFIG[fromLabel].key;
  const toProperty = LABEL_CONFIG[toLabel].key;
  const session = driver.session({ defaultAccessMode: "READ" });

  try {
    const cypherQuery = `
      MATCH (a:${fromLabel} {${fromProperty}: $fromName}),
            (b:${toLabel} {${toProperty}: $toName}),
            path = shortestPath((a)-[*..6]-(b))
      RETURN [node IN nodes(path) | {
        labels: labels(node),
        name: coalesce(node.name, node.title),
        year: node.year
      }] AS pathNodes,
      [rel IN relationships(path) | type(rel)] AS pathRels`;

    console.log(`Path Cypher: ${cypherQuery.replace(/\s+/g, " ").trim()}`);
    const queryResult = await session.run(cypherQuery, { fromName, toName });

    if (queryResult.records.length === 0) {
      return [{ error: `No connection found between ${fromName} and ${toName}` }];
    }

    return recordsToRows(queryResult);
  } finally {
    await session.close();
  }
}

async function runPlannedQuery(plan) {
  const { cypher, params: queryParams } = buildReadCypher(plan);
  console.log(`Cypher: ${cypher}`);
  console.log("Params:", queryParams);

  const session = driver.session({ defaultAccessMode: "READ" });
  try {
    const queryResult = await session.run(cypher, queryParams);
    return recordsToRows(queryResult);
  } finally {
    await session.close();
  }
}

async function answerGraphQuery(query, resolvedEntities) {
  console.log("Creating query plan");
  const plan = await makeQueryPlan(query, resolvedEntities);
  console.log("Plan:", JSON.stringify(plan, null, 2));

  let resultRows;
  const firstPlanStep = plan.steps?.[0];

  if (!firstPlanStep) {
    throw new Error("Query plan is empty.");
  }

  if (firstPlanStep.type === "describe") {
    console.log(`Describing ${firstPlanStep.label}: "${firstPlanStep.name}"`);
    resultRows = await runDescribeQuery(firstPlanStep.label, firstPlanStep.name);
  } else if (firstPlanStep.type === "path") {
    console.log(`Finding path: ${firstPlanStep.fromName} -> ${firstPlanStep.toName}`);
    resultRows = await runPathQuery(
      firstPlanStep.fromLabel,
      firstPlanStep.fromName,
      firstPlanStep.toLabel,
      firstPlanStep.toName
    );
  } else {
    console.log("Querying Neo4j");
    resultRows = await runPlannedQuery(plan);
  }

  console.log(`Got ${resultRows.length} result rows`);

  if (resultRows.length === 0 || resultRows[0]?.error) {
    const errorText = resultRows[0]?.error || "No results found";
    return `I could not find an answer: ${errorText}`;
  }

  const systemPrompt = `You are a helpful movie assistant.
Answer in plain English.
Use only the provided results.
If the user asks for more items than the results contain, return only the available results and say how many were found.
Do not mention databases, Cypher, JSON, vectors, or technical implementation.
For list-style answers, return at most 10 items unless the result is a count.`;

  const userPrompt = `Question:
${query}

Results:
${JSON.stringify(resultRows.slice(0, 10), null, 2)}

Write the final answer.`;

  const finalAnswer = await invokeLLM(systemPrompt, userPrompt);
  return finalAnswer.trim();
}

export { answerGraphQuery };
