from datetime import datetime
from core.config import settings
from services.memory_service import memory_service
import re


def filter_thinking_content(content):
    """Filter out thinking content enclosed in think tags from AI responses."""
    if not content or not isinstance(content, str):
        return content
    thinking_regex = r"<think\s*>[\s\S]*?</think\s*>"
    filtered_content = re.sub(thinking_regex, "", content, flags=re.IGNORECASE)
    filtered_content = re.sub(r"\n\s*\n\s*\n", "\n\n", filtered_content).strip()
    return filtered_content


class PersistentContextManager:
    """
    Manages session context. ScreenCopilot learns from every interaction.
    """

    def __init__(self):
        self.persistent_context = {
            "user_name": "",
            "persona_id": "general_chat",
            "custom_instructions": "",
            "created_at": None
        }
        self.conversation_history = []
        self.is_initialized = False

    def initialize_persistent_context(self, session_data=None):
        """Initialize context from session settings (persona, custom instructions)."""
        session_data = session_data or {}
        self.persistent_context.update({
            "user_name": session_data.get("name", ""),
            "persona_id": session_data.get("persona_id") or "general_chat",
            "custom_instructions": (session_data.get("custom_instructions") or "").strip(),
            "created_at": datetime.now().isoformat()
        })
        if session_data.get("name"):
            memory_service.update_profile({"name": session_data["name"]})
        self.is_initialized = True
        print(f"ScreenCopilot context initialized (persona: {self.persistent_context['persona_id']})")

    def set_persona(self, persona_id):
        self.persistent_context["persona_id"] = persona_id or "general_chat"

    def set_custom_instructions(self, text):
        self.persistent_context["custom_instructions"] = (text or "").strip()

    def add_conversation_exchange(self, question, response=None, ai_response=None):
        """Add conversation exchange limited to MAX_CONVERSATION_HISTORY."""
        filtered_ai_response = filter_thinking_content(ai_response) if ai_response else ai_response
        exchange = {
            "question": question,
            "user_response": response,
            "ai_response": filtered_ai_response,
            "timestamp": datetime.now().isoformat()
        }
        if question is None and response and self.conversation_history:
            self.conversation_history[-1]["user_response"] = response
        elif question is None and ai_response and self.conversation_history:
            self.conversation_history[-1]["ai_response"] = filtered_ai_response
        else:
            self.conversation_history.append(exchange)

        if settings.ENABLE_LEARNING and ai_response:
            self._learn_from_exchange(exchange)

        max_history = settings.MAX_CONVERSATION_HISTORY
        if len(self.conversation_history) > max_history:
            self.conversation_history = self.conversation_history[-max_history:]

    def _learn_from_exchange(self, exchange):
        """Extract learnings from conversation exchanges."""
        ai_resp = exchange.get("ai_response", "") or ""
        question = exchange.get("question", "") or ""
        combined = f"{question} {ai_resp}"[:500]
        if combined.strip():
            memory_service.add_conversation_summary(
                topic=question[:100] if question else "general_chat",
                key_insights=[ai_resp[:200]] if ai_resp else []
            )

    def add_ai_response(self, ai_response, response_type="normal"):
        """Add AI response to conversation history"""
        if response_type == "vision":
            ai_response = f"[VISION ANALYSIS] {ai_response}"
        filtered_ai_response = filter_thinking_content(ai_response)

        if self.conversation_history:
            self.conversation_history[-1]["ai_response"] = filtered_ai_response
        else:
            exchange = {
                "question": None,
                "user_response": None,
                "ai_response": filtered_ai_response,
                "timestamp": datetime.now().isoformat()
            }
            self.conversation_history.append(exchange)

        max_history = settings.MAX_CONVERSATION_HISTORY
        if len(self.conversation_history) > max_history:
            self.conversation_history = self.conversation_history[-max_history:]

        print(f"AI response added (type: {response_type}, total: {len(self.conversation_history)})")

    def get_complete_context(self):
        """Return complete context - persistent + conversation + learned memory."""
        memory_summary = memory_service.get_memory_summary()
        return {
            "persistent": self.persistent_context,
            "conversation_history": self.conversation_history,
            "memory_summary": memory_summary,
            "context_stats": {
                "conversation_exchanges": len(self.conversation_history),
                "is_initialized": self.is_initialized,
                "memory_enabled": bool(memory_summary)
            }
        }

    def ensure_context_available(self):
        """Verify persistent context is properly initialized."""
        return self.is_initialized

    def reset_conversation_history(self):
        """Resets the conversation history."""
        self.conversation_history = []
        print("Conversation history reset")
