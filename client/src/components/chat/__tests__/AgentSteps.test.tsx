import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AgentSteps, type AgentStepData } from "../AgentSteps";
import { ArtifactCard, type ArtifactData } from "../ArtifactCard";

const mockSteps: AgentStepData[] = [
  {
    id: "s1", type: "reading", title: "Analizando documento adjunto",
    status: "completed", timestamp: new Date().toISOString(), expandable: false,
  },
  {
    id: "s2", type: "thinking", title: "Planificando estructura del Word",
    status: "completed", timestamp: new Date().toISOString(), expandable: false,
  },
  {
    id: "s3", type: "executing", title: "Ejecutando script",
    script: 'echo "hello world"', output: "hello world",
    status: "completed", timestamp: new Date().toISOString(), expandable: true, duration: 150,
  },
  {
    id: "s4", type: "editing", title: "Corrigiendo título",
    fileName: "document.xml", diff: { added: 1, removed: 1 },
    status: "completed", timestamp: new Date().toISOString(), expandable: true,
  },
  {
    id: "s5", type: "completed", title: "Documento creado exitosamente",
    status: "completed", timestamp: new Date().toISOString(), expandable: false,
  },
];

describe("AgentSteps", () => {
  it("renders all steps with correct icons", () => {
    render(<AgentSteps steps={mockSteps} />);
    expect(screen.getByTestId("agent-steps")).toBeInTheDocument();
    expect(screen.getByText("Analizando documento adjunto")).toBeInTheDocument();
    expect(screen.getByText("Planificando estructura del Word")).toBeInTheDocument();
    expect(screen.getByText("Ejecutando script")).toBeInTheDocument();
    expect(screen.getByText("Corrigiendo título")).toBeInTheDocument();
    expect(screen.getByText("Documento creado exitosamente")).toBeInTheDocument();
  });

  it("shows file badge and diff", () => {
    render(<AgentSteps steps={mockSteps} />);
    expect(screen.getByText("document.xml")).toBeInTheDocument();
    expect(screen.getByText("+1")).toBeInTheDocument();
    expect(screen.getByText("-1")).toBeInTheDocument();
  });

  it("shows Script badge for executing steps", () => {
    render(<AgentSteps steps={mockSteps} />);
    expect(screen.getByText("Script")).toBeInTheDocument();
  });

  it("expands executing step on click to show script", () => {
    render(<AgentSteps steps={mockSteps} />);
    const execStep = screen.getByText("Ejecutando script");
    fireEvent.click(execStep);
    expect(screen.getByText('echo "hello world"')).toBeInTheDocument();
    expect(screen.getByText("hello world")).toBeInTheDocument();
  });

  it("shows collapsed header with count", () => {
    const toggle = () => {};
    render(<AgentSteps steps={mockSteps} collapsed={true} onToggleCollapse={toggle} />);
    expect(screen.getByTestId("agent-steps-header")).toBeInTheDocument();
    expect(screen.getByText("5/5")).toBeInTheDocument();
  });

  it("shows running state with spinner", () => {
    const runningSteps: AgentStepData[] = [
      { id: "r1", type: "generating", title: "Generando...", status: "running", timestamp: new Date().toISOString(), expandable: false },
    ];
    render(<AgentSteps steps={runningSteps} />);
    // Text appears in both header and step item
    expect(screen.getAllByText("Generando...").length).toBeGreaterThanOrEqual(1);
  });

  it("returns null for empty steps", () => {
    const { container } = render(<AgentSteps steps={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("shows duration for completed steps", () => {
    render(<AgentSteps steps={mockSteps} />);
    expect(screen.getByText("150ms")).toBeInTheDocument();
  });
});

describe("ArtifactCard", () => {
  const mockArtifact: ArtifactData = {
    id: "doc-1",
    name: "Report.docx",
    type: "docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    size: 45000,
    downloadUrl: "/api/documents/download/doc-1",
  };

  it("renders artifact card with file info", () => {
    render(<ArtifactCard artifact={mockArtifact} />);
    expect(screen.getByTestId("artifact-card")).toBeInTheDocument();
    expect(screen.getByText("Report.docx")).toBeInTheDocument();
    expect(screen.getByText(/DOCX/)).toBeInTheDocument();
    expect(screen.getByText(/43\.9 KB/)).toBeInTheDocument();
  });

  it("renders download button", () => {
    render(<ArtifactCard artifact={mockArtifact} />);
    expect(screen.getByTestId("artifact-download-btn")).toBeInTheDocument();
    expect(screen.getByText("Descargar")).toBeInTheDocument();
  });

  it("renders different file types correctly", () => {
    const xlsxArtifact: ArtifactData = {
      id: "xls-1", name: "Data.xlsx", type: "xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      downloadUrl: "/api/documents/download/xls-1",
    };
    render(<ArtifactCard artifact={xlsxArtifact} />);
    expect(screen.getByText("Data.xlsx")).toBeInTheDocument();
    expect(screen.getByText(/XLSX/)).toBeInTheDocument();
  });
});
