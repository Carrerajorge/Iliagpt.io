/**
 * Computer Use Module - Central exports for all agentic control capabilities
 *
 * This module provides ILIAGPT with full computer control:
 * - Computer Use Engine: Screen control with vision (like Anthropic Computer Use)
 * - Universal Browser Controller: Multi-browser agentic automation
 * - Autonomous Agent Brain: Self-initiative decision making (ReAct loop)
 * - Perfect PPT Generator: AI-driven professional presentations
 * - Perfect Document Generator: AI-driven professional documents
 * - Perfect Excel Generator: AI-driven professional spreadsheets
 * - Terminal Controller: Full OS command execution
 * - Vision Pipeline: Screen reading, OCR, element detection
 */

// Core engines
export { ComputerUseEngine, computerUseEngine } from "./computerUseEngine";
export type {
  ScreenCoordinate,
  ScreenRegion,
  MouseAction,
  KeyboardAction,
  ScreenAnalysis,
  DetectedElement,
  ComputerAction,
  ActionResult,
  ComputerUseSession,
  VisionAnalysisResult,
  SuggestedAction,
  TaskGoal,
} from "./computerUseEngine";

// Browser controller
export { UniversalBrowserController, universalBrowserController } from "./universalBrowserController";
export type {
  BrowserType,
  BrowserProfile,
  Tab,
  ElementInfo,
  ExtractionRule,
  AgenticTask,
  AgenticStep,
  TaskResult,
  StepResult,
  NetworkLog,
} from "./universalBrowserController";

// Autonomous brain
export { AutonomousAgentBrain, autonomousAgentBrain } from "./autonomousAgentBrain";
export type {
  AgentState,
  AgentGoal,
  GoalConstraints,
  ThoughtProcess,
  ActionPlan,
  PlannedAction,
  ActionOutcome,
  ReflectionResult,
  AgentMemory,
  AgentContext,
  ToolCapability,
  BrainConfig,
} from "./autonomousAgentBrain";

// Document generators
export { PerfectPptGenerator, perfectPptGenerator } from "./perfectPptGenerator";
export type { PresentationRequest, GeneratedPresentation } from "./perfectPptGenerator";

export { PerfectDocumentGenerator, perfectDocumentGenerator } from "./perfectDocumentGenerator";
export type { DocumentRequest, GeneratedDocument } from "./perfectDocumentGenerator";

export { PerfectExcelGenerator, perfectExcelGenerator } from "./perfectExcelGenerator";
export type { ExcelRequest, GeneratedExcel } from "./perfectExcelGenerator";

// Terminal control
export { TerminalController, terminalController } from "./terminalController";
export type {
  CommandRequest,
  CommandResult,
  ProcessInfo,
  SystemInfo,
  FileOperation,
  TerminalSession,
} from "./terminalController";

// Vision pipeline
export { VisionPipeline, visionPipeline } from "./visionPipeline";
export type {
  VisionQuery,
  VisionResult,
  UIElement,
  ScreenChange,
  AccessibilityReport,
  AccessibilityIssue,
  OCRResult,
  TextBlock,
} from "./visionPipeline";
