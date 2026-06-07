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

const ALLOWED_OPERATORS = new Set(["=", "<>", ">", "<", ">=", "<=", "CONTAINS", "STARTS WITH"]);

function cleanJson(raw) {
  return raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
}

function assertLabel(label) {
  if (!LABEL_CONFIG[label]) {
    throw new Error(`Unsupported label in query plan: ${label}`);
  }
}

function fieldToExpression(field) {
  const [label, property] = field.split(".");
  assertLabel(label);
  const allowed = label === "Movie" ? ["title", "year"] : label === "Award" ? ["name", "category"] : ["name"];
  if (!allowed.includes(property)) {
    throw new Error(`Unsupported field in query plan: ${field}`);
  }
  return `${LABEL_CONFIG[label].variable}.${property}`;
}

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

function recordsToObjects(result) {
  return result.records.map((record) => {
    const obj = {};
    record.keys.forEach((key) => {
      obj[key] = normalizeValue(record.get(key));
    });
    return obj;
  });
}

function getPatternForTraversal(step) {
  assertLabel(step.from);
  assertLabel(step.to);
  const key = `${step.from}:${step.rel}:${step.to}`;
  const direct = RELATIONSHIP_PATTERNS[key];
  if (direct) return direct;

  const reverseKey = `${step.to}:${step.rel}:${step.from}`;
  const reverse = RELATIONSHIP_PATTERNS[reverseKey];
  if (reverse) return reverse;

  throw new Error(`Unsupported traversal in query plan: ${key}`);
}

function buildCypher(plan) {
  
  if (!plan?.steps || !Array.isArray(plan.steps)) {
    throw new Error("Query plan must contain a steps array.");
  }

  const matchPatterns = [];
  const whereClauses = [];
  const params = {};
  let returnClause = null;
  let orderClause = "";
  let limitClause = "LIMIT 10";
  let paramIndex = 0;

  for (const step of plan.steps) {
    if (step.type === "traversal") {
      const pattern = getPatternForTraversal(step);
      if (!matchPatterns.includes(pattern)) {
        matchPatterns.push(pattern);
      }
    }

    if (step.type === "filter") {
      if (!ALLOWED_OPERATORS.has(step.op)) {
        throw new Error(`Unsupported filter operator: ${step.op}`);
      }
      const expr = fieldToExpression(step.field);
      const paramName = `p${paramIndex++}`;
      params[paramName] = step.value;

      if (step.op === "CONTAINS" || step.op === "STARTS WITH") {
        whereClauses.push(`toLower(${expr}) ${step.op} toLower($${paramName})`);
      } else {
        whereClauses.push(`${expr} ${step.op} $${paramName}`);
      }
    }

    if (step.type === "projection") {
      const fields = step.fields.map((field) => {
        const expr = fieldToExpression(field);
        const alias = field.replace(".", "_");
        return `${expr} AS ${alias}`;
      });
      returnClause = `RETURN ${step.distinct ? "DISTINCT " : ""}${fields.join(", ")}`;
    }

    if (step.type === "aggregation") {
      const expr = fieldToExpression(step.field);
      const alias = step.alias || "count";
      if (step.groupBy) {
        const groupExpr = fieldToExpression(step.groupBy);
        const groupAlias = step.groupBy.replace(".", "_");
        returnClause = `RETURN ${groupExpr} AS ${groupAlias}, count(DISTINCT ${expr}) AS ${alias}`;
      } else {
        returnClause = `RETURN count(DISTINCT ${expr}) AS ${alias}`;
      }
      limitClause = "";
    }

    if (step.type === "sort") {
      const expr = fieldToExpression(step.field);
      const direction = step.direction === "DESC" ? "DESC" : "ASC";
      orderClause = `ORDER BY ${expr} ${direction}`;
    }

    if (step.type === "limit") {
      const value = Number(step.value);
      if (Number.isInteger(value) && value > 0) {
        limitClause = `LIMIT ${Math.min(value, 10)}`;
      }
    }
  }

  if (matchPatterns.length === 0) {
    matchPatterns.push("(m:Movie)");
  }
  if (!returnClause) {
    returnClause = "RETURN DISTINCT m.title AS Movie_title, m.year AS Movie_year";
  }

  const cypher = [
    `MATCH ${matchPatterns.join(", ")}`,
    whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "",
    returnClause,
    orderClause,
    limitClause,
  ].filter(Boolean).join("\n");

  return { cypher, params };
}

async function createQueryPlan(query, resolvedEntities) {
  const entityContext = resolvedEntities.entities.length > 0
    ? resolvedEntities.entities
        .map((e) => `"${e.searchTerm}" = ${e.label} with database name "${e.nodeName}"`)
        .join("\n")
    : "No entities were resolved.";

  const unresolvedContext = resolvedEntities.unresolved.length > 0
    ? `\nUnresolved terms: ${resolvedEntities.unresolved.join(", ")}`
    : "";

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

  const raw = await invokeLLM(systemPrompt, query);
  try {
    return JSON.parse(cleanJson(raw));
  } catch (err) {
    console.error("Failed to parse query plan:", raw.substring(0, 300));
    throw new Error("Query planning failed. Please rephrase your question.");
  }
}

async function executeDescribe(label, name) {
  assertLabel(label);
  const session = driver.session({ defaultAccessMode: "READ" });

  try {
    let cypher;

    switch (label) {
      case "Movie":
        cypher = `
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
        cypher = `
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
        cypher = `
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
        cypher = `
          MATCH (m:Movie)-[:BELONGS_TO]->(g:Genre {name: $name})
          OPTIONAL MATCH (d:Director)-[:DIRECTED]->(m)
          RETURN g.name AS name,
                 collect(DISTINCT {title: m.title, year: m.year})[..10] AS movies,
                 collect(DISTINCT d.name) AS directors`;
        break;
      case "Theme":
        cypher = `
          MATCH (m:Movie)-[:EXPLORES]->(t:Theme {name: $name})
          OPTIONAL MATCH (d:Director)-[:DIRECTED]->(m)
          RETURN t.name AS name,
                 collect(DISTINCT {title: m.title, year: m.year})[..10] AS movies,
                 collect(DISTINCT d.name) AS directors`;
        break;
      case "Award":
        cypher = `
          MATCH (m:Movie)-[:WON]->(aw:Award {name: $name})
          OPTIONAL MATCH (d:Director)-[:DIRECTED]->(m)
          RETURN aw.name AS name,
                 collect(DISTINCT {title: m.title, year: m.year, category: aw.category})[..10] AS movies,
                 collect(DISTINCT d.name) AS directors`;
        break;
    }

    console.log(`Describe Cypher: ${cypher.replace(/\s+/g, " ").trim()}`);
    const result = await session.run(cypher, { name });
    return recordsToObjects(result);
  } finally {
    await session.close();
  }
}

async function executePath(fromLabel, fromName, toLabel, toName) {
  assertLabel(fromLabel);
  assertLabel(toLabel);

  const fromKey = LABEL_CONFIG[fromLabel].key;
  const toKey = LABEL_CONFIG[toLabel].key;
  const session = driver.session({ defaultAccessMode: "READ" });

  try {
    const cypher = `
      MATCH (a:${fromLabel} {${fromKey}: $fromName}),
            (b:${toLabel} {${toKey}: $toName}),
            path = shortestPath((a)-[*..6]-(b))
      RETURN [node IN nodes(path) | {
        labels: labels(node),
        name: coalesce(node.name, node.title),
        year: node.year
      }] AS pathNodes,
      [rel IN relationships(path) | type(rel)] AS pathRels`;

    console.log(`Path Cypher: ${cypher.replace(/\s+/g, " ").trim()}`);
    const result = await session.run(cypher, { fromName, toName });

    if (result.records.length === 0) {
      return [{ error: `No connection found between ${fromName} and ${toName}` }];
    }

    return recordsToObjects(result);
  } finally {
    await session.close();
  }
}

async function executeTemplateCypher(plan) {
  const { cypher, params } = buildCypher(plan);
  console.log(`Cypher: ${cypher}`);
  console.log("Params:", params);

  const session = driver.session({ defaultAccessMode: "READ" });
  try {
    const result = await session.run(cypher, params);
    return recordsToObjects(result);
  } finally {
    await session.close();
  }
}

async function handleGraphQuery(query, resolvedEntities) {
  console.log("Creating query plan");
  const plan = await createQueryPlan(query, resolvedEntities);
  console.log("Plan:", JSON.stringify(plan, null, 2));

  let records;
  const firstStep = plan.steps?.[0];

  if (!firstStep) {
    throw new Error("Query plan is empty.");
  }

  if (firstStep.type === "describe") {
    console.log(`Describing ${firstStep.label}: "${firstStep.name}"`);
    records = await executeDescribe(firstStep.label, firstStep.name);
  } else if (firstStep.type === "path") {
    console.log(`Finding path: ${firstStep.fromName} -> ${firstStep.toName}`);
    records = await executePath(
      firstStep.fromLabel,
      firstStep.fromName,
      firstStep.toLabel,
      firstStep.toName
    );
  } else {
    console.log("Querying Neo4j");
    records = await executeTemplateCypher(plan);
  }

  console.log(`Got ${records.length} result rows`);

  if (records.length === 0 || records[0]?.error) {
    const errorMsg = records[0]?.error || "No results found";
    return `I could not find an answer: ${errorMsg}`;
  }

  const systemPrompt = `You are a helpful movie assistant.
Answer in plain English.
Do not mention databases, Cypher, JSON, vectors, or technical implementation.
For list-style answers, return at most 10 items unless the result is a count.`;

  const userPrompt = `Question:
${query}

Results:
${JSON.stringify(records.slice(0, 10), null, 2)}

Write the final answer.`;

  const answer = await invokeLLM(systemPrompt, userPrompt);
  return answer.trim();
}

export { handleGraphQuery };
