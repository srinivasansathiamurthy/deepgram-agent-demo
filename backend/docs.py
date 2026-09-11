"""
Deepgram documentation retrieval — waterfall pipeline.

Startup:  load_index() fetches llms.txt and builds two branch indices:
          "docs"   — guides, quickstarts, SDK docs, integrations, platform
          "agents" — Voice Agent API: message flow, function calling, settings, telephony

Per query (triggered by Deepgram FunctionCallRequest):
  Step 1  Claude router (Sonnet) — reads compact index, decides which branches
          and which specific entries to fetch
  Step 2  httpx concurrent fetch — pulls selected .md pages, one or both branches,
          up to DOC_MAX_CHARS total per branch
  Step 3  Claude filter (Haiku) — extracts only the sections relevant to the query
          (skipped when raw content is short enough)

FastAPI router at /api/docs:
  GET  /index    — full parsed index with branch tags (debug)
  GET  /search   — router step only, no fetch (?q=...)
  POST /lookup   — full waterfall { "query": "..." }
"""

import asyncio
import json
import re
from typing import Optional

import httpx
from anthropic import AsyncAnthropic
from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from config import (
    ANTHROPIC_API_KEY,
    DEBUG_DIR,
    DOC_FETCH_TIMEOUT,
    DOC_FILTER_MAX_TOKENS,
    DOC_FILTER_MODEL,
    DOC_FILTER_OUTPUT_CHARS,
    DOC_FILTER_THRESHOLD,
    DOC_MAX_CHARS,
    DOC_MIN_CHUNK_CHARS,
    DOC_ROUTER_MAX_ENTRIES,
    DOC_ROUTER_MAX_TOKENS,
    DOC_ROUTER_MODEL,
    LLMS_TXT_URL,
)

router = APIRouter(prefix="/api/docs", tags=["docs"])

# ── module state ──────────────────────────────────────────────────────────────

DOC_INDEX: list[dict] = []
# Each entry: {title: str, url: str, description: str, branch: "docs"|"agents"}

_anthropic = AsyncAnthropic(api_key=ANTHROPIC_API_KEY)

# ── section → branch mapping ──────────────────────────────────────────────────

# Sections in llms.txt that map to each branch.
# Anything not matched is skipped entirely (e.g. Instructions for AI Agents).
_SECTION_BRANCH: dict[str, str] = {
    "Docs":                  "docs",
    "API Docs":              "api_docs",
    "OpenAPI Specification": "api_docs",
    "AsyncAPI Specification": "api_docs",
}


# ── startup index loader ──────────────────────────────────────────────────────

async def load_index() -> None:
    global DOC_INDEX
    # Matches both formats:
    #   - [Title](URL): Description          (Docs section)
    #   - REST API > Group [Title](URL)      (API Docs section — prefix before bracket)
    entry_re   = re.compile(r"^\s*-\s*([^\[]*?)\[([^\]]+)\]\(([^)]+)\)(?::\s*(.+))?$")
    section_re = re.compile(r"^##\s+(.+)$")
    try:
        async with httpx.AsyncClient(timeout=DOC_FETCH_TIMEOUT) as client:
            resp = await client.get(LLMS_TXT_URL)
            resp.raise_for_status()
            text = resp.text
    except Exception as exc:
        print(f"[docs] WARNING: could not fetch {LLMS_TXT_URL}: {exc}")
        return

    entries: list[dict] = []
    current_branch: str | None = None

    for line in text.splitlines():
        # Detect section header (## Docs, ## API Docs, etc.)
        sec = section_re.match(line)
        if sec:
            current_branch = _SECTION_BRANCH.get(sec.group(1).strip())
            continue

        # Skip lines that aren't under a known section
        if current_branch is None:
            continue

        m = entry_re.match(line)
        if not m:
            continue
        category    = m.group(1).strip()   # e.g. "REST API > Voice Agent" or ""
        title       = m.group(2)
        url         = m.group(3)
        description = (m.group(4) or "").strip()
        entries.append({
            "title":       title,
            "url":         url,
            "description": description,
            "category":    category,
            "branch":      current_branch,
        })

    DOC_INDEX = entries
    n_docs    = sum(1 for e in entries if e["branch"] == "docs")
    n_api     = sum(1 for e in entries if e["branch"] == "api_docs")
    print(f"[docs] Index loaded: {len(entries)} entries ({n_docs} docs, {n_api} api_docs)")

    # Write debug snapshot — overwritten on every startup
    DEBUG_DIR.mkdir(parents=True, exist_ok=True)
    debug_payload = {
        "total":    len(entries),
        "n_docs":   n_docs,
        "n_api_docs": n_api,
        "entries": [{"id": i, **e} for i, e in enumerate(entries)],
    }
    (DEBUG_DIR / "doc_index.json").write_text(
        json.dumps(debug_payload, indent=2), encoding="utf-8"
    )
    print(f"[docs] Debug index written → {DEBUG_DIR / 'doc_index.json'}")


# ── compact index prompt (per branch) ────────────────────────────────────────

def _compact_branch_prompt(branch: str) -> str:
    """Numbered index for a single branch. IDs are global DOC_INDEX positions."""
    lines = []
    for i, e in enumerate(DOC_INDEX):
        if e["branch"] != branch:
            continue
        if branch == "api_docs":
            prefix = f"{e['category']} > " if e.get("category") else ""
            line = f"[{i}] {prefix}{e['title']}"
        else:
            desc = f": {e['description']}" if e["description"] else ""
            line = f"[{i}] {e['title']}{desc}"
        lines.append(line)
    return "\n".join(lines)


# ── step 1: branch routers (run concurrently) ─────────────────────────────────

def _docs_router_system() -> str:
    return f"""\
You are routing a user query to Deepgram's conceptual documentation.
This index covers: getting-started guides, feature overviews, Voice Agent setup and
configuration, STT/TTS feature docs, SDK usage (Python, JS, Go, C#), integration
tutorials (Twilio, Pipecat, LiveKit, Amazon Connect, Genesys, Zoom, etc.),
authentication, CLI tooling, prompting guides, multilingual docs, troubleshooting,
and platform/account management.

Select up to {DOC_ROUTER_MAX_ENTRIES} entries by numeric ID that most directly answer
the query. If the query is purely about REST API endpoint specs or schemas and needs no
conceptual context, return an empty indices list.

Only return IDs that appear in the index. Do not invent IDs.
Respond with ONLY valid JSON — no prose, no markdown fences:
{{"indices": [12, 45], "reasoning": "one short sentence"}}
"""


def _api_router_system() -> str:
    return f"""\
You are routing a user query to Deepgram's REST API reference documentation.
This index covers exact endpoint specs, request/response schemas, and parameter
definitions for: Voice Agent management (agent configurations, agent variables),
Speech-to-Text (live streaming, pre-recorded, Flux/turn-based), Text-to-Speech
(streaming, single request, Flux), Text Intelligence (analyze text), and account
management (projects, models, API keys, members, usage, billing, on-premises).

Select up to {DOC_ROUTER_MAX_ENTRIES} entries by numeric ID whose endpoint specs
directly relate to the query. If the query is conceptual, tutorial-style, or does not
need API reference details, return an empty indices list.

Only return IDs that appear in the index. Do not invent IDs.
Respond with ONLY valid JSON — no prose, no markdown fences:
{{"indices": [325, 337], "reasoning": "one short sentence"}}
"""


async def _router_branch(query: str, branch: str) -> list[dict]:
    """Router for one branch. Returns [] if branch is not relevant to the query."""
    index_text = _compact_branch_prompt(branch)
    if not index_text:
        return []

    system = _docs_router_system() if branch == "docs" else _api_router_system()
    prompt = f"User query: {query}\n\nIndex:\n{index_text}"
    try:
        msg = await _anthropic.messages.create(
            model=DOC_ROUTER_MODEL,
            max_tokens=DOC_ROUTER_MAX_TOKENS,
            system=system,
            messages=[{"role": "user", "content": prompt}],
        )
        raw = msg.content[0].text.strip()
        data = json.loads(raw)
        indices = data.get("indices", [])
        entries = [
            DOC_INDEX[i]
            for i in indices
            if isinstance(i, int) and 0 <= i < len(DOC_INDEX) and DOC_INDEX[i]["branch"] == branch
        ]
        print(f"[docs] Router({branch}): {data.get('reasoning', '')} → {[e['title'] for e in entries]}")
        return entries
    except Exception as exc:
        print(f"[docs] Router({branch}) error: {exc}")
        return []


# ── step 2: fetch ─────────────────────────────────────────────────────────────

async def _fetch_entries(entries: list[dict]) -> str:
    if not entries:
        return ""

    async def _get(client: httpx.AsyncClient, url: str) -> str:
        try:
            r = await client.get(url)
            r.raise_for_status()
            return r.text
        except Exception as exc:
            print(f"[docs] Fetch error {url}: {exc}")
            return ""

    async with httpx.AsyncClient(timeout=DOC_FETCH_TIMEOUT) as client:
        pages = await asyncio.gather(*[_get(client, e["url"]) for e in entries])

    accumulated = ""
    for page, entry in zip(pages, entries):
        if not page:
            continue
        chunk = f"### {entry['title']}\n{page}"
        if len(accumulated) + len(chunk) > DOC_MAX_CHARS:
            remaining = DOC_MAX_CHARS - len(accumulated)
            if remaining > DOC_MIN_CHUNK_CHARS:
                accumulated += chunk[:remaining]
            break
        accumulated += chunk + "\n\n"

    return accumulated


# ── step 3: filter ────────────────────────────────────────────────────────────

def _filter_system() -> str:
    return f"""\
You are a documentation extractor. Given a user query and raw Deepgram documentation
markdown, extract ONLY the sections, paragraphs, and code snippets that directly
answer the query. Remove unrelated content. Preserve technical accuracy.
Output plain text — no markdown fences, no preamble. Keep the result under {DOC_FILTER_OUTPUT_CHARS} characters.
"""


async def _filter(query: str, raw: str) -> str:
    try:
        msg = await _anthropic.messages.create(
            model=DOC_FILTER_MODEL,
            max_tokens=DOC_FILTER_MAX_TOKENS,
            system=_filter_system(),
            messages=[{"role": "user", "content": f"Query: {query}\n\n{raw}"}],
        )
        return msg.content[0].text.strip()
    except Exception as exc:
        print(f"[docs] Filter error: {exc}")
        return raw[:DOC_FILTER_THRESHOLD]


# ── orchestrator ──────────────────────────────────────────────────────────────

async def lookup_docs(query: str) -> str:
    if not DOC_INDEX:
        return "Documentation index is not loaded. Please try again in a moment."

    if not query.strip():
        return "No query was provided to look up."

    # Step 1: both branch routers run concurrently — each sees only its branch index
    docs_entries, api_entries = await asyncio.gather(
        _router_branch(query, "docs"),
        _router_branch(query, "api_docs"),
    )
    print(f"[docs] Router totals: docs={len(docs_entries)}, api_docs={len(api_entries)}")

    if not docs_entries and not api_entries:
        return "I was not able to find relevant documentation for that query."

    # Step 2: both branch fetches run concurrently
    raw_docs, raw_api = await asyncio.gather(
        _fetch_entries(docs_entries),
        _fetch_entries(api_entries),
    )

    # Step 3: merge with section labels so the filter knows which source is which
    parts = []
    if raw_docs:
        parts.append("## Documentation\n" + raw_docs)
    if raw_api:
        parts.append("## API Reference\n" + raw_api)
    raw = "\n\n".join(parts)

    if not raw:
        return "I found relevant documentation entries but could not fetch their content."

    # Step 4: filter (skip if content is short enough)
    if len(raw) > DOC_FILTER_THRESHOLD:
        result = await _filter(query, raw)
    else:
        result = raw

    return result or "The documentation did not contain a clear answer to that question."


# ── REST endpoints (debug / eval) ─────────────────────────────────────────────

class LookupBody(BaseModel):
    query: str


@router.get("/index")
async def index_endpoint():
    return {
        "total":    len(DOC_INDEX),
        "docs":     [e for e in DOC_INDEX if e["branch"] == "docs"],
        "api_docs": [e for e in DOC_INDEX if e["branch"] == "api_docs"],
    }


@router.get("/search")
async def search_endpoint(q: str = ""):
    if not q:
        return JSONResponse({"error": "provide ?q=your+query"}, status_code=400)
    docs_entries, api_entries = await asyncio.gather(
        _router_branch(q, "docs"),
        _router_branch(q, "api_docs"),
    )
    return {"docs": docs_entries, "api_docs": api_entries}


@router.post("/lookup")
async def lookup_endpoint(body: LookupBody):
    result = await lookup_docs(body.query)
    return {"query": body.query, "result": result}
