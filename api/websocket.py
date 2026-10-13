import asyncio
import orjson
from datetime import datetime
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query
from typing import Optional

from .session_manager import session_manager
from .utils import send_json

router = APIRouter()

@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, session_id: Optional[str] = Query(None)):
    """
    Main WebSocket endpoint. Handles new connections and resumes existing sessions.
    """
    session = None
    if session_id:
        session = session_manager.get_session(session_id)
        if session:
            print(f"🔗 Resuming session: {session_id}")
            session.websocket = websocket
            await websocket.accept()
            await send_json(websocket, "session_resumed", {"session_id": session.session_id, "is_active": session.is_active})
        else:
            print(f"⚠️ Session not found: {session_id}. Creating new session.")
    
    if not session:
        await websocket.accept()
        session = session_manager.create_session()
        session.websocket = websocket
        await send_json(websocket, "session_created", {"session_id": session.session_id})

    try:
        while True:
            message = await websocket.receive_json()
            message_type = message.get("type")
            payload = message.get("payload", {})

            # Route message to the appropriate handler within the session
            handler = getattr(session, f"handle_{message_type}", None)
            if handler:
                try:
                    await handler(payload)
                except Exception as handler_err:
                    print(f"❌ Handler error in session {session.session_id} for '{message_type}': {handler_err}")
                    try:
                        await send_json(websocket, "error", {
                            "message": f"Error processing '{message_type}': {str(handler_err)[:200]}",
                            "type": message_type
                        })
                    except Exception:
                        pass  # Don't crash if we can't send the error
            else:
                print(f"⚠️ Unknown message type: {message_type}")

    except WebSocketDisconnect:
        print(f"🔌 WebSocket disconnected from session: {session.session_id}")
        await _detach(session, websocket)
    except Exception as e:
        print(f"❌ Unhandled WebSocket error in session {session.session_id}: {e}")
        await _detach(session, websocket)


async def _detach(session, websocket: WebSocket):
    """Detach `websocket` from its session unless a newer connection already took over."""
    if session.websocket is not websocket:
        return
    session.websocket = None
    try:
        # Nobody is listening any more, so release the Deepgram connection.
        await session.handle_stop_listening({})
    except Exception as e:
        print(f"⚠️ Error stopping listening for session {session.session_id}: {e}")