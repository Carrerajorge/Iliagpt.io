import { describe, it, expect } from "vitest";
import {
  detectCompoundIntent,
  validateCompoundPlan,
  serializeCompoundResult,
  isResearchEnabled,
  type CompoundIntentResult
} from "../compoundIntentPlanner";

describe("CompoundIntentPlanner", () => {
  describe("detectCompoundIntent", () => {
    it("should detect Spanish research + report pattern", () => {
      const result = detectCompoundIntent(
        "investiga sobre energías renovables y créame un informe en word",
        "es"
      );

      expect(result.isCompound).toBe(true);
      expect(result.intent).toBe("CREATE_DOCUMENT");
      expect(result.doc_type).toBe("REPORT");
      expect(result.output_format).toBe("docx");
      expect(result.requires_research).toBe(true);
      expect(result.topic).toContain("energías renovables");
      expect(result.plan).not.toBeNull();
      expect(result.plan?.steps.length).toBe(6);
    });

    it("should detect English research + report pattern", () => {
      const result = detectCompoundIntent(
        "research renewable energy and create a report in word",
        "en"
      );

      expect(result.isCompound).toBe(true);
      expect(result.intent).toBe("CREATE_DOCUMENT");
      expect(result.doc_type).toBe("REPORT");
      expect(result.requires_research).toBe(true);
    });

    it("should generate correct plan steps for research + document", () => {
      const result = detectCompoundIntent(
        "investiga sobre inteligencia artificial y crea un informe detallado",
        "es"
      );

      expect(result.plan).not.toBeNull();
      const steps = result.plan!.steps;

      expect(steps[0].type).toBe("WEB_RESEARCH");
      expect(steps[1].type).toBe("EVIDENCE_BUILD");
      expect(steps[2].type).toBe("OUTLINE");
      expect(steps[3].type).toBe("DRAFT_SECTIONS");
      expect(steps[4].type).toBe("FACT_VERIFY");
      expect(steps[5].type).toBe("RENDER_DOCX");
    });

    it("should include correct constraints in WEB_RESEARCH step", () => {
      const result = detectCompoundIntent(
        "investiga sobre cambio climático y haz un reporte",
        "es"
      );

      const webResearchStep = result.plan?.steps.find(s => s.type === "WEB_RESEARCH");
      expect(webResearchStep).toBeDefined();
      
      if (webResearchStep?.type === "WEB_RESEARCH") {
        expect(webResearchStep.constraints.language).toBe("es");
        expect(webResearchStep.min_sources).toBe(5);
      }
    });

    it("should include FACT_VERIFY with halt_below_rate", () => {
      const result = detectCompoundIntent(
        "research climate change and write a comprehensive report",
        "en"
      );

      const factVerifyStep = result.plan?.steps.find(s => s.type === "FACT_VERIFY");
      expect(factVerifyStep).toBeDefined();
      
      if (factVerifyStep?.type === "FACT_VERIFY") {
        expect(factVerifyStep.halt_below_rate).toBe(0.8);
      }
    });

    it("should include RENDER_DOCX with template and theme", () => {
      const result = detectCompoundIntent(
        "investiga sobre economía circular y crea un informe",
        "es"
      );

      const renderStep = result.plan?.steps.find(s => s.type === "RENDER_DOCX");
      expect(renderStep).toBeDefined();
      
      if (renderStep?.type === "RENDER_DOCX") {
        expect(renderStep.template).toBe("report_v1");
        expect(renderStep.theme).toBe("default");
      }
    });

    it("should not detect compound intent for simple document request", () => {
      const result = detectCompoundIntent(
        "crea un documento en word",
        "es"
      );

      expect(result.isCompound).toBe(false);
      expect(result.requires_research).toBe(false);
    });

    it("should not detect compound intent for simple chat", () => {
      const result = detectCompoundIntent(
        "hola, ¿cómo estás?",
        "es"
      );

      expect(result.isCompound).toBe(false);
      expect(result.intent).toBe("CHAT_GENERAL");
    });

    it("should detect CV document type", () => {
      const result = detectCompoundIntent(
        "investiga mi perfil profesional y crea un CV",
        "es"
      );

      expect(result.doc_type).toBe("CV");
    });

    it("should detect letter document type", () => {
      const result = detectCompoundIntent(
        "investiga la empresa y redacta una carta de presentación",
        "es"
      );

      expect(result.doc_type).toBe("LETTER");
    });

    it("should detect proposal document type", () => {
      const result = detectCompoundIntent(
        "research the market and create a business proposal",
        "en"
      );

      expect(result.doc_type).toBe("PROPOSAL");
    });

    it("should detect Portuguese research + report pattern", () => {
      const result = detectCompoundIntent(
        "pesquisa sobre energia renovável e cria um relatório",
        "pt"
      );

      expect(result.isCompound).toBe(true);
      expect(result.doc_type).toBe("REPORT");
      expect(result.locale).toBe("pt");
    });

    it("should detect French research + report pattern", () => {
      const result = detectCompoundIntent(
        "recherche sur les énergies renouvelables et crée un rapport",
        "fr"
      );

      expect(result.isCompound).toBe(true);
      expect(result.doc_type).toBe("REPORT");
    });

    it("should detect German research + report pattern", () => {
      const result = detectCompoundIntent(
        "recherchiere über erneuerbare Energien und erstelle einen Bericht",
        "de"
      );

      expect(result.isCompound).toBe(true);
      expect(result.doc_type).toBe("REPORT");
    });

    it("should include OUTLINE step with localized sections for Spanish", () => {
      const result = detectCompoundIntent(
        "investiga sobre blockchain y crea un informe",
        "es"
      );

      const outlineStep = result.plan?.steps.find(s => s.type === "OUTLINE");
      expect(outlineStep).toBeDefined();
      
      if (outlineStep?.type === "OUTLINE") {
        expect(outlineStep.sections).toContain("resumen ejecutivo");
        expect(outlineStep.sections).toContain("referencias");
        expect(outlineStep.sections).toContain("conclusiones");
      }
    });

    it("should include OUTLINE step with English sections for English", () => {
      const result = detectCompoundIntent(
        "research blockchain technology and create a report",
        "en"
      );

      const outlineStep = result.plan?.steps.find(s => s.type === "OUTLINE");
      expect(outlineStep).toBeDefined();
      
      if (outlineStep?.type === "OUTLINE") {
        expect(outlineStep.sections).toContain("executive summary");
        expect(outlineStep.sections).toContain("references");
        expect(outlineStep.sections).toContain("conclusions");
      }
    });
  });

  describe("validateCompoundPlan", () => {
    it("should validate a correct compound plan", () => {
      const result = detectCompoundIntent(
        "investiga sobre AI y crea un informe",
        "es"
      );

      const validation = validateCompoundPlan(result);
      
      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it("should return validation for non-compound intent", () => {
      const result = detectCompoundIntent(
        "hola mundo",
        "es"
      );

      const validation = validateCompoundPlan(result);
      
      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it("should warn if topic not extracted", () => {
      const result: CompoundIntentResult = {
        isCompound: true,
        intent: "CREATE_DOCUMENT",
        doc_type: "REPORT",
        output_format: "docx",
        topic: null,
        requires_research: true,
        plan: { id: "test", steps: [] },
        confidence: 0.9,
        locale: "es"
      };

      const validation = validateCompoundPlan(result);
      
      expect(validation.warnings).toContain("topic_not_extracted");
    });
  });

  describe("serializeCompoundResult", () => {
    it("should serialize compound result correctly", () => {
      const result = detectCompoundIntent(
        "investiga sobre tecnología y crea un informe",
        "es"
      );

      const serialized = serializeCompoundResult(result);
      
      expect(serialized.isCompound).toBe(true);
      expect(serialized.intent).toBe("CREATE_DOCUMENT");
      expect(serialized.doc_type).toBe("REPORT");
      expect(serialized.plan).not.toBeNull();
      expect(typeof serialized.plan).toBe("object");
    });
  });

  describe("isResearchEnabled", () => {
    it("should return true by default", () => {
      expect(isResearchEnabled()).toBe(true);
    });
  });
});
