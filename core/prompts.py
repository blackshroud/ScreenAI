# --- core/prompts.py ---
# ScreenAI: General-purpose AI assistant prompt system

from core.config import settings
from core.personas import get_persona_prompt
from typing import Dict, List, Optional
from services.context_manager import PersistentContextManager
from services.memory_service import memory_service



def get_chat_prompt(question: str, context_manager: PersistentContextManager, persona_id: str = "general_chat") -> str:
    """Generate a prompt for general chat with learned context."""
    complete_context = context_manager.get_complete_context()
    persistent_context = complete_context['persistent']
    conversation_history = complete_context['conversation_history']
    memory_summary = complete_context.get('memory_summary', '')

    prompt_parts = []

    persona_id = persistent_context.get('persona_id') or persona_id
    prompt_parts.append(get_persona_prompt(persona_id))

    custom_instructions = (persistent_context.get('custom_instructions') or '').strip()
    if custom_instructions:
        prompt_parts.append(f"\n=== USER'S CUSTOM INSTRUCTIONS ===\n{custom_instructions}")

    prompt_parts.append("""
KEY PRINCIPLES:
- Be concise but thorough
- Remember user preferences and context
- Proactively suggest next steps and automations
- Learn from every interaction
- Provide actionable, real-time guidance

FORMATTING:
- Use clear markdown structure with headers and bullet points
- Bold key terms for emphasis
- Include code blocks with syntax highlighting when appropriate
- Use emojis strategically for visual organization
""")



    if memory_summary and memory_summary != '(No learned context yet)':
        prompt_parts.append(f"\n=== LEARNED CONTEXT ===\n{memory_summary}")

    if conversation_history:
        recent = conversation_history[-3:]
        history_text = []
        for ex in recent:
            q = ex.get('question', '') or ''
            a = ex.get('ai_response', '') or ''
            if q:
                history_text.append(f"User: {q}")
            if a:
                history_text.append(f"ScreenAI: {a}")
        if history_text:
            prompt_parts.append(f"\n=== RECENT CONVERSATION ===\n" + "\n".join(history_text[-6:]))

    prompt_parts.append(f"\n=== CURRENT QUESTION ===\n{question}")

    prompt_parts.append("""\n=== RESPONSE INSTRUCTIONS ===
Provide a helpful, context-aware answer. If relevant, suggest next steps or automations.

**ANSWER:**""")

    return "\n".join(prompt_parts)


def get_quick_response_prompt(question: str, context_manager: Optional[PersistentContextManager]) -> str:
    """Short-form prompt used when GENERATE_FULL_ANSWERS is false."""
    persona_id = "general_chat"
    custom_instructions = ""
    if context_manager is not None:
        persistent = context_manager.get_complete_context()['persistent']
        persona_id = persistent.get('persona_id') or persona_id
        custom_instructions = (persistent.get('custom_instructions') or '').strip()

    parts = [get_persona_prompt(persona_id)]
    if custom_instructions:
        parts.append(f"\nUSER'S CUSTOM INSTRUCTIONS:\n{custom_instructions}")
    parts.append("\nRespond briefly and directly: a few sentences or a short list. "
                 "Skip preamble. Use a code block only when code is needed.")
    parts.append(f"\nREQUEST:\n{question}\n\n**ANSWER:**")
    return "\n".join(parts)


def get_suggestion_prompt(question: str, context_manager: PersistentContextManager) -> str:
    """Generate a prompt for real-time suggestions."""
    complete_context = context_manager.get_complete_context()
    memory_summary = complete_context.get('memory_summary', '')

    prompt_parts = []
    prompt_parts.append("""You are ScreenAI's suggestion engine.
Analyze the user's current situation and provide real-time, actionable suggestions.
Focus on: next steps, automation opportunities, time-saving tips, and learning-based recommendations.

Respond in this format:

## Suggested Next Steps
- [step 1]
- [step 2]

## Automation Opportunities
- [automation 1]
- [automation 2]

## Time-Saving Tips
- [tip 1]
- [tip 2]

**SUGGESTIONS:**""")

    if memory_summary and memory_summary != '(No learned context yet)':
        prompt_parts.append(f"\nLEARNED CONTEXT:\n{memory_summary}")

    prompt_parts.append(f"\nCURRENT SITUATION:\n{question}")

    return "\n".join(prompt_parts)


def get_automation_prompt(question: str, context_manager: PersistentContextManager) -> str:
    """Generate a prompt for automation detection."""
    complete_context = context_manager.get_complete_context()
    memory_summary = complete_context.get('memory_summary', '')

    prompt_parts = []
    prompt_parts.append("""You are ScreenAI's automation detector.
Analyze the user's task history and current situation to identify repetitive patterns
that could be automated to save time.

Respond in this format:

## Detected Patterns
- [pattern 1]: [description]

## Suggested Automations
1. **[Automation Name]**: [description]
   - Trigger: [when to run]
   - Action: [what to do]

## Estimated Time Savings
- [estimate]

**AUTOMATION SUGGESTIONS:**""")

    if memory_summary and memory_summary != '(No learned context yet)':
        prompt_parts.append(f"\nLEARNED CONTEXT:\n{memory_summary}")

    prompt_parts.append(f"\nCURRENT SITUATION:\n{question}")

    return "\n".join(prompt_parts)

