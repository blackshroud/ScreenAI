import asyncio
from datetime import datetime
from typing import Dict, List, Optional, Any


class SuggestionEngine:
    """Generates real-time suggestions and automation opportunities."""

    def __init__(self, memory_service=None):
        self.memory = memory_service

    async def analyze_task_completion(self, task_name, category="other", context=None):
        suggestions = []
        history = self.memory.get_task_history(limit=20)
        related = [t for t in history if t.get("category") == category and t.get("task_name") != task_name]
        if related:
            suggestions.append({
                "type": "related_task",
                "title": f"Related {category} tasks",
                "items": [t["task_name"] for t in related[-3:]],
                "priority": "medium"
            })
        if len(history) >= 2:
            prev_tasks = [t["task_name"] for t in history[-5:]]
            suggestions.append({
                "type": "sequence",
                "title": "Recent: " + " -> ".join(prev_tasks[-3:]),
                "priority": "low"
            })
        if context:
            self.memory.add_task_history(task_name, category=category, context=context)
        return suggestions

    async def detect_automation_opportunities(self):
        tasks = self.memory.get_task_history(limit=100)
        if len(tasks) < 5:
            return []
        name_counts = {}
        for task in tasks:
            name = task.get("task_name", "")
            name_counts[name] = name_counts.get(name, 0) + 1
        opportunities = []
        for name, count in name_counts.items():
            if count >= 3:
                opportunities.append({
                    "name": f"Automate: {name}",
                    "description": f"Completed '{name}' {count} times. Auto-repeat?",
                    "frequency": count,
                    "status": "suggested"
                })
        return opportunities

    async def get_realtime_suggestions(self, current_context=None):
        suggestions = []
        pending_autos = self.memory.get_automations()
        if pending_autos:
            suggestions.append({
                "type": "automation_pending",
                "title": "Pending automation suggestions",
                "items": [a.get("description", "") for a in pending_autos],
                "priority": "medium"
            })
        if current_context:
            for auto in pending_autos:
                desc = auto.get("description", "").lower()
                if str(current_context).lower() in desc:
                    suggestions.append({
                        "type": "contextual",
                        "title": f"Context match: {auto.get('description', '')}",
                        "priority": "high"
                    })
        return suggestions

    async def suggest_next_steps(self, task_name, category):
        suggestions = []
        suggestions.append({
            "type": "general",
            "title": "What would you like to do next?",
            "items": ["Start a new task", "Review completed tasks", "Check for automations"],
            "priority": "medium"
        })
        return suggestions


_suggestion_engine = None


def get_suggestion_engine(memory_service=None):
    global _suggestion_engine
    if _suggestion_engine is None:
        _suggestion_engine = SuggestionEngine(memory_service)
    return _suggestion_engine
