import json
import os
import re
import sys
from pathlib import Path

from dotenv import load_dotenv
from ragas import EvaluationDataset, evaluate
from ragas.metrics import (
    Faithfulness,
    ResponseRelevancy,
    LLMContextPrecisionWithReference,
    LLMContextRecall,
    FactualCorrectness,
)
from langchain_openai import ChatOpenAI
from langchain_google_genai import GoogleGenerativeAIEmbeddings


ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = ROOT / "evaluation" / "outputs"


def strip_json_fences(text):
    if not isinstance(text, str):
        return text
    stripped = text.strip()
    match = re.fullmatch(r"```(?:json)?\s*(.*?)\s*```", stripped, flags=re.DOTALL)
    return match.group(1).strip() if match else text


class FenceStrippingChatOpenAI(ChatOpenAI):
    def _clean_result(self, result):
        for generation in result.generations:
            message = generation.message
            if isinstance(message.content, str):
                message.content = strip_json_fences(message.content)
        return result

    def _generate(self, *args, **kwargs):
        return self._clean_result(super()._generate(*args, **kwargs))

    async def _agenerate(self, *args, **kwargs):
        return self._clean_result(await super()._agenerate(*args, **kwargs))


def load_rows(filename):
    rows = json.loads((OUTPUT_DIR / filename).read_text())
    return [
        {
            "user_input": row["question"],
            "response": row["answer"],
            "retrieved_contexts": row["contexts"],
            "reference": row["ground_truth"],
            "type": row.get("type", "unknown"),
            "id": row.get("id"),
        }
        for row in rows
    ]


def average(values):
    clean = [value for value in values if value is not None]
    return sum(clean) / len(clean) if clean else None


def result_to_rows(result):
    df = result.to_pandas()
    return json.loads(df.to_json(orient="records"))


def summarize(rows):
    metric_names = [
        "faithfulness",
        "answer_relevancy",
        "llm_context_precision_with_reference",
        "context_recall",
        "factual_correctness",
    ]
    summary = {}
    for metric in metric_names:
        values = []
        for row in rows:
            value = row.get(metric)
            if value == value:
                values.append(value)
        summary[metric] = average(values)

    faithfulness = summary.get("faithfulness")
    summary["hallucination_rate"] = None if faithfulness is None else 1 - faithfulness
    return summary


def load_score_rows(filename):
    path = OUTPUT_DIR / filename
    if not path.exists():
        return []
    return json.loads(path.read_text())


def format_percent(value):
    if value is None:
        return "n/a"
    return f"{value * 100:.2f}%"


def write_report(vector_summary, graph_summary, question_count, metric_mode):
    vector_hallucination = vector_summary.get("hallucination_rate")
    graph_hallucination = graph_summary.get("hallucination_rate")

    if vector_hallucination and vector_hallucination > 0 and graph_hallucination is not None:
        reduction = (vector_hallucination - graph_hallucination) / vector_hallucination
    else:
        reduction = None

    content = f"""# Hallucination Evaluation Report

This report was generated from a local RAGAS run over the movie GraphRAG project.

## Setup

- Evaluation questions: {question_count}
- Baseline system: vector-only RAG using Pinecone contexts.
- Improved system: hybrid GraphRAG using Neo4j graph facts as contexts.
- Judge framework: RAGAS.
- Completed scoring mode: {metric_mode}.
- Main hallucination metric: faithfulness.
- Hallucination rate formula: `1 - faithfulness`.

## Summary

| Metric | Vector-only RAG | Hybrid GraphRAG |
| --- | ---: | ---: |
| Faithfulness | {format_percent(vector_summary.get("faithfulness"))} | {format_percent(graph_summary.get("faithfulness"))} |
| Hallucination rate | {format_percent(vector_summary.get("hallucination_rate"))} | {format_percent(graph_summary.get("hallucination_rate"))} |
| Answer relevancy | {format_percent(vector_summary.get("answer_relevancy"))} | {format_percent(graph_summary.get("answer_relevancy"))} |
| Context precision | {format_percent(vector_summary.get("llm_context_precision_with_reference"))} | {format_percent(graph_summary.get("llm_context_precision_with_reference"))} |
| Context recall | {format_percent(vector_summary.get("context_recall"))} | {format_percent(graph_summary.get("context_recall"))} |
| Factual correctness | {format_percent(vector_summary.get("factual_correctness"))} | {format_percent(graph_summary.get("factual_correctness"))} |

## Hallucination Improvement

| Measurement | Value |
| --- | ---: |
| Vector-only hallucination rate | {format_percent(vector_hallucination)} |
| Hybrid GraphRAG hallucination rate | {format_percent(graph_hallucination)} |
| Relative hallucination reduction | {format_percent(reduction)} |

## Interpretation

Faithfulness measures whether the generated answer is supported by the retrieved context. A higher faithfulness score means fewer unsupported claims. The hallucination rate here is computed as `1 - faithfulness`.

If Hybrid GraphRAG has higher faithfulness than vector-only RAG, it means graph facts from Neo4j gave the model more reliable context for factual and multi-hop questions.

## Generated Files

- `evaluation/outputs/eval_questions.json`
- `evaluation/outputs/vector_results.json`
- `evaluation/outputs/graphrag_results.json`
- `evaluation/outputs/vector_ragas_scores.json`
- `evaluation/outputs/graphrag_ragas_scores.json`
- `evaluation/outputs/ragas_summary.json`

## Caveat

These scores are only valid for this generated evaluation set and the current database contents. For a resume or report, state the number of evaluated questions and do not claim a larger benchmark than what was actually run.

If a metric row is `n/a`, that metric was not included in the completed scoring mode for this run.
"""

    (ROOT / "hallucination.md").write_text(content)


def main():
    load_dotenv(ROOT / ".env")

    nvidia_key = os.getenv("NVIDIA_API_KEY")
    gemini_key = os.getenv("GEMINI_API_KEY")
    if not nvidia_key:
        raise RuntimeError("NVIDIA_API_KEY is required for the RAGAS judge LLM.")
    if not gemini_key:
        raise RuntimeError("GEMINI_API_KEY is required for answer relevancy embeddings.")

    os.environ["GOOGLE_API_KEY"] = gemini_key

    llm = FenceStrippingChatOpenAI(
        model="mistralai/mistral-medium-3.5-128b",
        api_key=nvidia_key,
        base_url="https://integrate.api.nvidia.com/v1",
        temperature=0,
        timeout=120,
        max_retries=1,
        model_kwargs={"response_format": {"type": "json_object"}},
    )

    embeddings = GoogleGenerativeAIEmbeddings(
        model="models/gemini-embedding-001",
        google_api_key=gemini_key,
    )

    metric_mode = "full"
    systems = "both"
    for arg in sys.argv[1:]:
        if arg.startswith("--metrics="):
            metric_mode = arg.split("=", 1)[1]
        if arg.startswith("--systems="):
            systems = arg.split("=", 1)[1]

    allowed_systems = {"both", "vector", "graph"}
    if systems not in allowed_systems:
        raise RuntimeError(f"--systems must be one of {sorted(allowed_systems)}")

    if metric_mode == "faithfulness":
        metrics = [Faithfulness(llm=llm)]
    else:
        metrics = [
            Faithfulness(llm=llm),
            ResponseRelevancy(llm=llm, embeddings=embeddings),
            LLMContextPrecisionWithReference(llm=llm),
            LLMContextRecall(llm=llm),
            FactualCorrectness(llm=llm),
        ]

    vector_data = load_rows("vector_results.json")
    graph_data = load_rows("graphrag_results.json")

    if systems in {"both", "vector"}:
        vector_result = evaluate(
            EvaluationDataset.from_list(vector_data),
            metrics=metrics,
            llm=llm,
            embeddings=embeddings,
            raise_exceptions=False,
            batch_size=1,
        )
        vector_rows = result_to_rows(vector_result)
        (OUTPUT_DIR / "vector_ragas_scores.json").write_text(json.dumps(vector_rows, indent=2))
    else:
        vector_rows = load_score_rows("vector_ragas_scores.json")

    if systems in {"both", "graph"}:
        graph_result = evaluate(
            EvaluationDataset.from_list(graph_data),
            metrics=metrics,
            llm=llm,
            embeddings=embeddings,
            raise_exceptions=False,
            batch_size=1,
        )
        graph_rows = result_to_rows(graph_result)
        (OUTPUT_DIR / "graphrag_ragas_scores.json").write_text(json.dumps(graph_rows, indent=2))
    else:
        graph_rows = load_score_rows("graphrag_ragas_scores.json")

    vector_summary = summarize(vector_rows)
    graph_summary = summarize(graph_rows)

    (OUTPUT_DIR / "ragas_summary.json").write_text(json.dumps({
        "question_count": len(vector_data),
        "metric_mode": metric_mode,
        "scored_systems": systems,
        "vector_only": vector_summary,
        "hybrid_graphrag": graph_summary,
    }, indent=2))

    write_report(vector_summary, graph_summary, len(vector_data), metric_mode)
    print(json.dumps({
        "question_count": len(vector_data),
        "vector_only": vector_summary,
        "hybrid_graphrag": graph_summary,
    }, indent=2))


if __name__ == "__main__":
    main()
