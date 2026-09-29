import json
import os
import threading
import uuid
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Any


class MemoryService:
    """Persistent, thread-safe memory for the ScreenAI assistant."""
    
    DEFAULT_MEMORY_FILE = "screenai_memory.json"
    
    def __init__(self, memory_dir=None, memory_file=None):
        self.memory_dir = Path(memory_dir or ".")
        self.memory_file = self.memory_dir / (memory_file or self.DEFAULT_MEMORY_FILE)
        self._lock = threading.Lock()
        self._data = self._load()
    
    def _load(self):
        if self.memory_file.exists():
            try:
                with open(self.memory_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                return self._migrate(data)
            except (json.JSONDecodeError, IOError, OSError) as e:
                print(f"Warning: Memory load error, starting fresh: {e}")
        return self._default_memory()
    
    def _default_memory(self):
        return {
            "user_profile": {
                "name": "", "role": "", "company": "",
                "preferences": {
                    "communication_style": "concise",
                    "preferred_tools": [], "timezone": "", "working_hours": ""
                },
                "skills": [], "projects": []
            },
            "task_history": [],
            "learned_patterns": [],
            "automation_catalog": [],
            "conversation_summaries": [],
            "created_at": datetime.now().isoformat(),
            "last_updated": datetime.now().isoformat()
        }
    
    def _migrate(self, data):
        default = self._default_memory()
        for key in default:
            if key not in data:
                data[key] = default[key]
        if "user_profile" in data:
            for subkey in ["preferences", "skills", "projects"]:
                if subkey not in data["user_profile"]:
                    data["user_profile"][subkey] = default["user_profile"][subkey]
            if "preferences" in data["user_profile"]:
                for pk in ["communication_style", "preferred_tools", "timezone", "working_hours"]:
                    if pk not in data["user_profile"]["preferences"]:
                        data["user_profile"]["preferences"][pk] = default["user_profile"]["preferences"][pk]
        return data
    
    def _save(self):
        with self._lock:
            self._data["last_updated"] = datetime.now().isoformat()
            temp_file = self.memory_file.with_suffix(".tmp")
            with open(temp_file, "w", encoding="utf-8") as f:
                json.dump(self._data, f, indent=2, default=str, ensure_ascii=False)
            temp_file.replace(self.memory_file)
    
    def get_profile(self):
        return self._data.get("user_profile", {})
    
    def update_profile(self, updates):
        profile = self._data.get("user_profile", {})
        if "preferences" in updates and "preferences" in profile:
            profile["preferences"].update(updates.pop("preferences"))
        profile.update(updates)
        self._data["user_profile"] = profile
        self._save()
        return profile
    
    def record_task(self, name, category="other", context=None, outcome="success", duration_seconds=None):
        task = {
            "id": str(uuid.uuid4()), "name": name, "category": category,
            "context": context or {}, "outcome": outcome,
            "duration_seconds": duration_seconds,
            "completed_at": datetime.now().isoformat(),
            "suggestions_given": [], "automation_suggested": False
        }
        history = self._data.get("task_history", [])
        history.append(task)
        self._data["task_history"] = history[-200:]
        self._save()
        return task
    
    def get_task_history(self, limit=50):
        history = self._data.get("task_history", [])
        return history[-limit:]
    
    def add_pattern(self, pattern, category="workflow", frequency=1):
        patterns = self._data.get("learned_patterns", [])
        for p in patterns:
            if p.get("pattern") == pattern:
                p["frequency"] = p.get("frequency", 1) + frequency
                p["last_seen"] = datetime.now().isoformat()
                self._save()
                return p
        patterns.append({"pattern": pattern, "category": category, "frequency": frequency, "last_seen": datetime.now().isoformat()})
        self._data["learned_patterns"] = patterns
        self._save()
        return patterns[-1]
    
    def get_learned_patterns(self, min_frequency=2):
        patterns = self._data.get("learned_patterns", [])
        return [p for p in patterns if p.get("frequency", 0) >= min_frequency]
    
    def add_automation(self, name, description, trigger, action, status="suggested"):
        automations = self._data.get("automation_catalog", [])
        automation = {"id": str(uuid.uuid4()), "name": name, "description": description,
                      "trigger": trigger, "action": action, "status": status,
                      "created_at": datetime.now().isoformat()}
        automations.append(automation)
        self._data["automation_catalog"] = automations
        self._save()
        return automation
    
    def get_automation_catalog(self, status=None):
        automations = self._data.get("automation_catalog", [])
        if status:
            automations = [a for a in automations if a.get("status") == status]
        return automations
    
    def update_automation_status(self, automation_id, status):
        automations = self._data.get("automation_catalog", [])
        for a in automations:
            if a.get("id") == automation_id:
                a["status"] = status
                self._save()
                return True
        return False
    
    def add_conversation_summary(self, topic, key_insights):
        summaries = self._data.get("conversation_summaries", [])
        summaries.append({"topic": topic, "key_insights": key_insights, "timestamp": datetime.now().isoformat()})
        self._data["conversation_summaries"] = summaries[-50:]
        self._save()
    
    def get_memory_summary(self):
        profile = self._data.get("user_profile", {})
        patterns = self.get_learned_patterns(min_frequency=2)
        automations = self.get_automation_catalog(status="confirmed")
        tasks = self.get_task_history(limit=10)
        parts = []
        name = profile.get("name", "")
        role = profile.get("role", "")
        company = profile.get("company", "")
        prefs = profile.get("preferences", {})
        skills = profile.get("skills", [])
        projects = profile.get("projects", [])
        if name: parts.append(f"User: {name}")
        if role: parts.append(f"Role: {role}")
        if company: parts.append(f"Company: {company}")
        if skills: parts.append(f"Skills: {', '.join(skills)}")
        if projects: parts.append(f"Projects: {', '.join(projects)}")
        if prefs.get("communication_style"): parts.append(f"Communication style: {prefs['communication_style']}")
        if prefs.get("preferred_tools"): parts.append(f"Preferred tools: {', '.join(prefs['preferred_tools'])}")
        if patterns:
            pd = [f"{p['pattern']} (freq: {p['frequency']})" for p in patterns]
            parts.append(f"Learned patterns: {'; '.join(pd)}")
        if automations:
            an = [f"{a['name']}: {a['action']}" for a in automations]
            parts.append(f"Active automations: {'; '.join(an)}")
        if tasks:
            recent = [f"{t['name']} ({t.get('outcome', 'unknown')})" for t in tasks[-5:]]
            parts.append(f"Recent tasks: {'; '.join(recent)}")
        return "\n".join(parts) if parts else ""
    
    def get_full_memory(self):
        return self._data.copy()
    
    def consolidate(self):
        tasks = self._data.get("task_history", [])
        if len(tasks) < 3:
            return {"patterns_found": 0, "automations_suggested": 0}
        category_counts = {}
        for task in tasks:
            cat = task.get("category", "other")
            category_counts[cat] = category_counts.get(cat, 0) + 1
        new_patterns = 0
        for cat, count in category_counts.items():
            if count >= 3:
                pattern = self.add_pattern(f"Frequently performs {cat} tasks", category="workflow", frequency=count)
                if pattern: new_patterns += 1
        automations_suggested = 0
        frequent_tasks = [t for t in tasks if category_counts.get(t.get("category", "other"), 0) >= 3]
        if frequent_tasks:
            task_names = {}
            for t in frequent_tasks:
                name = t["name"]
                task_names[name] = task_names.get(name, 0) + 1
            for name, count in task_names.items():
                if count >= 3:
                    existing = any(a["name"] == f"Automate: {name}" for a in self._data.get("automation_catalog", []))
                    if not existing:
                        self.add_automation(name=f"Automate: {name}", description=f"Auto-execute '{name}' workflow based on {count} completions", trigger=f"When user starts or completes '{name}'", action=f"Automate '{name}' workflow", status="suggested")
                        automations_suggested += 1
        return {"patterns_found": new_patterns, "automations_suggested": automations_suggested}

memory_service = MemoryService()
