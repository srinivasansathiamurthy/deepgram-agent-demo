"""
Eval harness — QA flows for the voice agent evaluation process.

Routes:
  GET  /api/eval/flows  — list of all chat flows
"""

import json
from pathlib import Path

from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/api/eval", tags=["eval"])

FLOWS_FILE = Path(__file__).parent.parent / "eval" / "chat_flows.json"


def _load_flows() -> list[dict]:
    return json.loads(FLOWS_FILE.read_text(encoding="utf-8"))


@router.get("/flows")
async def get_flows():
    try:
        return _load_flows()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
