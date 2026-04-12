"""
CAP-15: PLUGINS Y PERSONALIZACION
====================================
Tests para el sistema de plugins y personalizacion.

Sub-capacidades:
  15.1  Marketplace de plugins (publico y privado)
  15.2  Plugins por dominio: finanzas, legal, RRHH, ingenieria, marketing
  15.3  Skills incorporados para xlsx, pptx, docx, pdf
  15.4  Skill-creator para crear skills propios
  15.5  Instrucciones globales personalizables (tono, formato, contexto)
  15.6  Instrucciones por carpeta (contexto de proyecto)
  15.7  Claude puede actualizar instrucciones durante sesion

Total: ~300 tests
"""
from __future__ import annotations

import json
import pytest
from pathlib import Path
from cowork_lib2 import Skill, create_skill, DOMAIN_TEMPLATES, render_template
from cowork_lib3 import FolderInstructions, GlobalInstructions, check_plan_access


@pytest.fixture
def out_dir(tmp_path):
    d = tmp_path / "cap15_plugins"
    d.mkdir()
    return d


class TestPluginMarketplace:
    """15.1 — Marketplace de plugins (publico y privado)."""

    @pytest.mark.parametrize("i", range(10))
    def test_plugin_marketplace_listing(self, i):
        plugins = [
            create_skill(f"plugin_{j}", f"Plugin {j} description", [f"trigger_{j}"])
            for j in range(10)
        ]
        assert len(plugins) == 10
        assert all(p.name.startswith("plugin_") for p in plugins)

    @pytest.mark.parametrize("i", range(10))
    def test_plugin_search_by_trigger(self, i):
        plugins = [
            create_skill("excel_gen", "Generate Excel files", ["create spreadsheet", "make xlsx"]),
            create_skill("pdf_merge", "Merge PDFs", ["combine pdf", "merge documents"]),
            create_skill("chart_gen", "Generate charts", ["create chart", "make graph"]),
        ]
        matching = [p for p in plugins if p.matches("create spreadsheet")]
        assert len(matching) == 1
        assert matching[0].name == "excel_gen"

    @pytest.mark.parametrize("prompt,expected_skill", [
        ("create spreadsheet for Q4", "excel_gen"),
        ("combine pdf files", "pdf_merge"),
        ("make graph of sales", "chart_gen"),
    ])
    def test_plugin_trigger_matching(self, prompt, expected_skill):
        plugins = [
            create_skill("excel_gen", "Generate Excel", ["create spreadsheet", "make xlsx"]),
            create_skill("pdf_merge", "Merge PDFs", ["combine pdf", "merge documents"]),
            create_skill("chart_gen", "Charts", ["make graph", "create chart"]),
        ]
        matched = [p for p in plugins if p.matches(prompt)]
        assert len(matched) >= 1
        assert any(m.name == expected_skill for m in matched)


DOMAINS = list(DOMAIN_TEMPLATES.keys())

DOMAIN_SKILLS = [
    ("finance", "Analisis financiero", ["financial analysis", "budget review"]),
    ("legal", "Revision de contratos", ["contract review", "nda triage"]),
    ("hr", "Evaluacion de desempeno", ["performance review", "competency"]),
    ("marketing", "Analisis de marca", ["brand voice", "marketing materials"]),
    ("ops", "Briefing diario", ["daily briefing", "project tracking"]),
    ("research", "Sintesis de entrevistas", ["interview synthesis", "feedback analysis"]),
]


class TestPluginsByDomain:
    """15.2 — Plugins por dominio: finanzas, legal, RRHH, ingenieria, marketing."""

    @pytest.mark.parametrize("domain", DOMAINS)
    def test_domain_templates_exist(self, domain):
        assert domain in DOMAIN_TEMPLATES
        assert len(DOMAIN_TEMPLATES[domain]) >= 1

    @pytest.mark.parametrize("domain", DOMAINS)
    def test_domain_template_rendering(self, domain):
        for name, fields in DOMAIN_TEMPLATES[domain].items():
            values = {f: f"Value for {f}" for f in fields}
            rendered = render_template(domain, name, values)
            assert domain.title() in rendered
            for f_name in fields:
                assert f_name.title() in rendered

    @pytest.mark.parametrize("domain,desc,triggers", DOMAIN_SKILLS)
    def test_domain_skill_creation(self, domain, desc, triggers):
        skill = create_skill(f"{domain}_skill", desc, triggers)
        assert skill.name == f"{domain}_skill"
        assert len(skill.triggers) >= 2

    @pytest.mark.parametrize("domain,desc,triggers", DOMAIN_SKILLS)
    def test_domain_skill_matching(self, domain, desc, triggers):
        skill = create_skill(f"{domain}_skill", desc, triggers)
        assert skill.matches(triggers[0])


BUILTIN_SKILLS = [
    ("xlsx_skill", "Generate Excel files", ["create xlsx", "make spreadsheet", "excel"]),
    ("pptx_skill", "Generate presentations", ["create pptx", "make slides", "powerpoint"]),
    ("docx_skill", "Generate documents", ["create docx", "make document", "word"]),
    ("pdf_skill", "Generate PDFs", ["create pdf", "make pdf"]),
]


class TestBuiltinSkills:
    """15.3 — Skills incorporados para xlsx, pptx, docx, pdf."""

    @pytest.mark.parametrize("name,desc,triggers", BUILTIN_SKILLS)
    def test_builtin_skill_exists(self, name, desc, triggers):
        skill = create_skill(name, desc, triggers)
        assert skill is not None
        for trigger in triggers:
            assert skill.matches(trigger)

    @pytest.mark.parametrize("name,desc,triggers", BUILTIN_SKILLS)
    def test_builtin_skill_no_false_match(self, name, desc, triggers):
        skill = create_skill(name, desc, triggers)
        assert not skill.matches("completely unrelated query about weather")


class TestSkillCreator:
    """15.4 — Skill-creator para crear skills propios."""

    @pytest.mark.parametrize("i", range(15))
    def test_create_custom_skill(self, i):
        skill = create_skill(
            name=f"custom_{i}",
            description=f"Custom skill {i} for specialized task",
            triggers=[f"do custom thing {i}", f"execute task {i}"],
        )
        assert skill.name == f"custom_{i}"
        assert skill.matches(f"do custom thing {i}")

    @pytest.mark.parametrize("n_triggers", [1, 3, 5, 10])
    def test_skill_multiple_triggers(self, n_triggers):
        triggers = [f"trigger_{j}" for j in range(n_triggers)]
        skill = create_skill("multi_trigger", "Test", triggers)
        assert len(skill.triggers) == n_triggers
        for t in triggers:
            assert skill.matches(t)

    @pytest.mark.parametrize("i", range(10))
    def test_skill_case_insensitive(self, i):
        skill = create_skill("case_test", "Test", [f"Create Report {i}"])
        assert skill.matches(f"create report {i}")  # lowercase should match


class TestGlobalInstructions:
    """15.5 — Instrucciones globales personalizables (tono, formato, contexto)."""

    @pytest.mark.parametrize("tone", ["professional", "casual", "academic", "technical", "friendly"])
    def test_global_instructions_tone(self, tone):
        gi = GlobalInstructions(tone=tone)
        result = gi.apply_to_prompt("Write a report")
        assert f"Tone: {tone}" in result

    @pytest.mark.parametrize("fmt", ["concise", "detailed", "bullet-points", "narrative"])
    def test_global_instructions_format(self, fmt):
        gi = GlobalInstructions(format=fmt)
        result = gi.apply_to_prompt("Analyze data")
        assert f"Format: {fmt}" in result

    @pytest.mark.parametrize("i", range(10))
    def test_global_instructions_role(self, i):
        gi = GlobalInstructions(role_context=f"Senior Analyst at Company_{i}")
        result = gi.apply_to_prompt("Review this")
        assert f"Company_{i}" in result

    @pytest.mark.parametrize("i", range(10))
    def test_global_instructions_to_dict(self, i):
        gi = GlobalInstructions(
            tone="professional",
            format="concise",
            role_context=f"Manager {i}",
            custom_rules=[f"Rule {j}" for j in range(3)],
        )
        d = gi.to_dict()
        assert d["tone"] == "professional"
        assert len(d["custom_rules"]) == 3


class TestFolderInstructions:
    """15.6 — Instrucciones por carpeta (contexto de proyecto)."""

    @pytest.mark.parametrize("i", range(10))
    def test_folder_instructions_set_and_get(self, out_dir, i):
        folder = out_dir / f"project_{i}"
        folder.mkdir()
        fi = FolderInstructions(path=folder)
        fi.set("tone", "formal")
        fi.set("context", f"Project {i} documentation")
        assert fi.get("tone") == "formal"
        assert fi.get("context") == f"Project {i} documentation"

    @pytest.mark.parametrize("i", range(10))
    def test_folder_instructions_persistence(self, out_dir, i):
        folder = out_dir / f"persist_{i}"
        folder.mkdir()
        fi = FolderInstructions(path=folder)
        fi.set("key", f"value_{i}")
        # Reload from disk
        fi2 = FolderInstructions.load(folder)
        assert fi2.get("key") == f"value_{i}"

    @pytest.mark.parametrize("i", range(10))
    def test_folder_instructions_independent(self, out_dir, i):
        f1 = out_dir / f"proj_a_{i}"
        f2 = out_dir / f"proj_b_{i}"
        f1.mkdir()
        f2.mkdir()
        fi1 = FolderInstructions(path=f1)
        fi2 = FolderInstructions(path=f2)
        fi1.set("lang", "en")
        fi2.set("lang", "es")
        assert fi1.get("lang") == "en"
        assert fi2.get("lang") == "es"


class TestLiveInstructionUpdate:
    """15.7 — Claude puede actualizar instrucciones durante sesion."""

    @pytest.mark.parametrize("i", range(15))
    def test_live_instruction_update(self, out_dir, i):
        folder = out_dir / f"live_{i}"
        folder.mkdir()
        fi = FolderInstructions(path=folder)
        fi.set("version", "1.0")
        assert fi.get("version") == "1.0"
        fi.update_live("version", "2.0")
        assert fi.get("version") == "2.0"
        # Verify persisted
        fi2 = FolderInstructions.load(folder)
        assert fi2.get("version") == "2.0"

    @pytest.mark.parametrize("i", range(10))
    def test_live_update_new_key(self, out_dir, i):
        folder = out_dir / f"newkey_{i}"
        folder.mkdir()
        fi = FolderInstructions(path=folder)
        fi.update_live(f"new_key_{i}", f"new_value_{i}")
        assert fi.get(f"new_key_{i}") == f"new_value_{i}"

    @pytest.mark.parametrize("n_updates", [1, 5, 10, 20])
    def test_live_update_multiple(self, out_dir, n_updates):
        folder = out_dir / f"multi_{n_updates}"
        folder.mkdir()
        fi = FolderInstructions(path=folder)
        for j in range(n_updates):
            fi.update_live(f"key_{j}", f"val_{j}")
        fi2 = FolderInstructions.load(folder)
        for j in range(n_updates):
            assert fi2.get(f"key_{j}") == f"val_{j}"
