"""
Eval harness routes.

  GET  /api/eval/flows      — chat flows (used by Audio Capture tab for TTS ask loop)
  GET  /api/eval/questions  — 50 sampled eval questions for control vs experimental judging
"""

import json
from pathlib import Path

from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/api/eval", tags=["eval"])

_EVAL_DIR = Path(__file__).parent.parent / "eval"


def _load(filename: str) -> list[dict]:
    return json.loads((_EVAL_DIR / filename).read_text(encoding="utf-8"))


@router.get("/flows")
async def get_flows():
    try:
        return _load("chat_flows.json")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/questions")
async def get_questions():
    try:
        return _load("eval_questions.json")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
