"""
SSE streaming endpoint for the agentic shortlist pipeline.
Streams real-time agent thoughts, tool calls, and results to the frontend.
"""

import json
import logging
import asyncio
from fastapi import APIRouter, Request
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

from .graph import get_graph, create_initial_state

log = logging.getLogger(__name__)

router = APIRouter(prefix="/agents", tags=["agents"])


class ShortlistRequest(BaseModel):
    query_text: str = Field(..., description="Free-text query or job description")
    filters: dict = Field(default_factory=dict, description="Optional filters (location, etc.)")
    limit: int = Field(default=20, description="Max results to return")


@router.post("/shortlist")
async def shortlist_stream(request: ShortlistRequest):
    """
    Stream the agentic shortlist pipeline via SSE.
    Each event has: event type, agent name, message, and optional data.
    """
    graph = get_graph()
    initial_state = create_initial_state(
        query_text=request.query_text,
        filters=request.filters,
    )

    async def event_generator():
        try:
            # Stream using LangGraph's astream with custom writer events
            # Stream using LangGraph's astream with custom writer events
            async for event in graph.astream(
                initial_state,
                stream_mode="custom",
            ):
                # Handle different yield structures from astream
                if isinstance(event, tuple):
                    chunk = event[0]
                    # metadata = event[1] if len(event) > 1 else {}
                else:
                    chunk = event

                # chunk is the data emitted by writer() in each node
                if isinstance(chunk, dict):
                    event_type = chunk.get("event", "update")
                    yield {
                        "event": event_type,
                        "data": json.dumps(chunk, default=str),
                    }

            # Send completion event
            yield {
                "event": "done",
                "data": json.dumps({"message": "Pipeline complete"}),
            }

        except Exception as e:
            log.error(f"Pipeline error: {e}", exc_info=True)
            yield {
                "event": "error",
                "data": json.dumps({"message": str(e), "stage": "pipeline"}),
            }

    return EventSourceResponse(event_generator())


@router.post("/shortlist/sync")
async def shortlist_sync(request: ShortlistRequest):
    """
    Non-streaming version — runs full pipeline and returns final result.
    Useful for testing and backwards compat.
    """
    graph = get_graph()
    initial_state = create_initial_state(
        query_text=request.query_text,
        filters=request.filters,
    )

    # Collect all custom stream events to find the final result
    final_result = None
    try:
        async for event in graph.astream(
            initial_state,
            stream_mode="custom",
        ):
            if isinstance(event, tuple):
                chunk = event[0]
            else:
                chunk = event
            if isinstance(chunk, dict) and chunk.get("event") == "result":
                final_result = chunk.get("data", {})

        if final_result:
            return final_result
        else:
            return {"error": "Pipeline completed but no result was produced"}

    except Exception as e:
        log.error(f"Pipeline error: {e}", exc_info=True)
        return {"error": str(e)}
