import { driver, invokeLLM } from "./Config.js";
const LABELS = {
  Movie: { variable: "m", key: "title", fields: ["title", "year"] },
  Director: { variable: "d", key: "name", fields: ["name"] },
  Actor: { variable: "a", key: "name", fields: ["name"] },
  Genre: { variable: "g", key: "name", fields: ["name"] },
  Theme: { variable: "t", key: "name", fields: ["name"] },
  Award: { variable: "aw", key: "name", fields: ["name", "category"] },
};
const PATTERNS = {
  "Director:DIRECTED:Movie": "(d:Director)-[:DIRECTED]->(m:Movie)",
  "Actor:ACTED_IN:Movie": "(a:Actor)-[:ACTED_IN]->(m:Movie)",
  "Movie:BELONGS_TO:Genre": "(m:Movie)-[:BELONGS_TO]->(g:Genre)",
  "Movie:EXPLORES:Theme": "(m:Movie)-[:EXPLORES]->(t:Theme)",
  "Movie:WON:Award": "(m:Movie)-[:WON]->(aw:Award)",
};

const OPERATORS = new Set(["=", "<>", ">", "<", ">=", "<=", "CONTAINS", "STARTS WITH"]);
function getLabel(label) {

  const config = LABELS[label];
  if (!config) throw new Error(`Unsupported label: ${label}`);
  return config;
}
function getField(field) {
  const [label, property] = String(field).split(".");
  const config = getLabel(label);
  if (!config.fields.includes(property)) throw new Error(`Unsupported field: ${field}`);
  return `${config.variable}.${property}`;
}
function getPattern(step) {
  getLabel(step.from);
  getLabel(step.to);
  const direct = `${step.from}:${step.rel}:${step.to}`;
  const reverse = `${step.to}:${step.rel}:${step.from}`;
  const pattern = PATTERNS[direct] || PATTERNS[reverse];
  if (!pattern) throw new Error(`Unsupported traversal: ${direct}`);
  return pattern;
}
function plain(value) {
  if (value && typeof value.toNumber === "function") return value.toNumber();
  if (Array.isArray(value)) return value.map(plain);
  if (value && typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, plain(item)]));
  return value;
}
async function readQuery(cypher, params = {}) {
  const session = driver.session({ defaultAccessMode: "READ" });
  try {
    const result = await session.run(cypher, params);
    return result.records.map((record) => Object.fromEntries(
      record.keys.map((key) => [key, plain(record.get(key))])
    ));
  } finally {
    await session.close();
  }
}
function buildCypher(plan) {
  if (!Array.isArray(plan?.steps)) throw new Error("Query plan must contain steps.");

  const matches = [];
  const filters = [];
  const params = {};
  let projection = "";
  let order = "";
  let limit = "LIMIT 10";
  let paramNumber = 0;

  for (const step of plan.steps) {
    switch (step.type) {
      case "traversal": {
        const pattern = getPattern(step);
        if (!matches.includes(pattern)) matches.push(pattern);
        break;
      }
      case "filter": {
        if (!OPERATORS.has(step.op)) throw new Error(`Unsupported operator: ${step.op}`);
        const field = getField(step.field);
        const param = `p${paramNumber++}`;
        params[param] = step.value;
        const textFilter = step.op === "CONTAINS" || step.op === "STARTS WITH";
        filters.push(textFilter ? `toLower(${field}) ${step.op} toLower($${param})`
          : `${field} ${step.op} $${param}`);
        break;
      }
      case "projection":
        projection = `RETURN ${step.distinct ? "DISTINCT " : ""}${step.fields
          .map((field) => `${getField(field)} AS ${field.replace(".", "_")}`).join(", ")}`;
        break;
      case "aggregation": {
        const field = getField(step.field);
        const alias = /^[A-Za-z_]\w*$/.test(step.alias || "") ? step.alias : "count";
        projection = step.groupBy
          ? `RETURN ${getField(step.groupBy)} AS ${step.groupBy.replace(".", "_")}, count(DISTINCT ${field}) AS ${alias}`
          : `RETURN count(DISTINCT ${field}) AS ${alias}`;
        limit = "";
        break;
      }
      case "sort":
        order = `ORDER BY ${getField(step.field)} ${step.direction === "DESC" ? "DESC" : "ASC"}`;
        break;
      case "limit": {
        const value = Number(step.value);
        if (Number.isInteger(value) && value > 0) limit = `LIMIT ${Math.min(value, 10)}`;
        break;
      }
      default:
        throw new Error(`Unsupported query step: ${step.type}`);
    }
  }

  if (!matches.length) matches.push("(m:Movie)");
  if (!projection) projection = "RETURN DISTINCT m.title AS Movie_title, m.year AS Movie_year";

  const parts = [`MATCH ${matches.join(", ")}`,
    filters.length ? `WHERE ${filters.join(" AND ")}` : "",
    projection, order, limit];
  return { cypher: parts.filter(Boolean).join("\n"), params };
}

async function createPlan(query, resolvedEntities) {
  const entities = resolvedEntities.entities.length
    ? resolvedEntities.entities.map((entity) =>
        `"${entity.searchTerm}" = ${entity.label} named "${entity.nodeName}"`
      ).join("\n")
    : "No entities resolved.";

  const prompt = `Create a read-only JSON query plan for this movie graph.
Entities:\n${entities}
Schema: Movie(title, year), Director(name), Actor(name), Genre(name), Theme(name), Award(name, category).
Relationships: Director-DIRECTED->Movie, Actor-ACTED_IN->Movie, Movie-BELONGS_TO->Genre, Movie-EXPLORES->Theme, Movie-WON->Award.
Return {"steps":[]} using only these step shapes:
{"type":"traversal","from":"Director|Actor|Movie","rel":"allowed relationship","to":"allowed label"}
{"type":"filter","field":"Label.property","op":"=","value":"exact value"}
{"type":"projection","fields":["Movie.title","Movie.year"],"distinct":true}
{"type":"aggregation","function":"count","field":"Movie.title","alias":"total"}
{"type":"sort","field":"Movie.year","direction":"DESC"}
{"type":"limit","value":10}
{"type":"describe","label":"Movie","name":"exact name"}
{"type":"path","fromLabel":"Actor","fromName":"exact name","toLabel":"Director","toName":"exact name"}
Use exact resolved names. Use describe for details, path for connections, and traversal for lists or counts. Return JSON only.`;

  const response = await invokeLLM(prompt, query);
  try {
    return JSON.parse(response.replace(/```json\n?|```\n?/g, "").trim());
  } catch {
    throw new Error("Query planning failed. Please rephrase your question.");
  }
}

async function describeEntity(step) {
  const config = getLabel(step.label);
  const cypher = `MATCH (n:${step.label} {${config.key}: $name})
    OPTIONAL MATCH (n)--(related:Movie)
    WITH n, CASE WHEN n:Movie THEN n ELSE related END AS m
    OPTIONAL MATCH (d:Director)-[:DIRECTED]->(m)
    OPTIONAL MATCH (a:Actor)-[:ACTED_IN]->(m)
    OPTIONAL MATCH (m)-[:BELONGS_TO]->(g:Genre)
    OPTIONAL MATCH (m)-[:EXPLORES]->(t:Theme)
    OPTIONAL MATCH (m)-[:WON]->(aw:Award)
    RETURN coalesce(n.title, n.name) AS entity, n.category AS category,
      collect(DISTINCT {title: m.title, year: m.year})[..10] AS movies,
      collect(DISTINCT d.name) AS directors, collect(DISTINCT a.name) AS actors,
      collect(DISTINCT g.name) AS genres, collect(DISTINCT t.name) AS themes,
      collect(DISTINCT {name: aw.name, category: aw.category}) AS awards`;
  return readQuery(cypher, { name: step.name });
}

async function findPath(step) {
  const from = getLabel(step.fromLabel);
  const to = getLabel(step.toLabel);
  const cypher = `MATCH (a:${step.fromLabel} {${from.key}: $fromName}),
    (b:${step.toLabel} {${to.key}: $toName}), path = shortestPath((a)-[*..6]-(b))
    RETURN [node IN nodes(path) | coalesce(node.name, node.title)] AS nodes,
      [rel IN relationships(path) | type(rel)] AS relationships`;
  const rows = await readQuery(cypher, { fromName: step.fromName, toName: step.toName });
  return rows.length ? rows : [{ error: "No connection found." }];
}

async function answerGraphQuery(query, resolvedEntities) {
  const plan = await createPlan(query, resolvedEntities);
  const first = plan.steps?.[0];
  if (!first) throw new Error("Query plan is empty.");

  let rows;
  if (first.type === "describe") rows = await describeEntity(first);
  else if (first.type === "path") rows = await findPath(first);
  else {
    const built = buildCypher(plan);
    rows = await readQuery(built.cypher, built.params);
  }

  if (!rows.length || rows[0]?.error) {
    return `I could not find an answer: ${rows[0]?.error || "No results found"}`;
  }

  const systemPrompt = "Answer the movie question in plain English using only the provided results. Return at most 10 list items and do not mention technical implementation.";
  const userPrompt = `Question:\n${query}\n\nResults:\n${JSON.stringify(rows.slice(0, 10), null, 2)}`;
  return (await invokeLLM(systemPrompt, userPrompt)).trim();
}

export { answerGraphQuery };
