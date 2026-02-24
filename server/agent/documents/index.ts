/**
 * Document Generation Module — Public API
 *
 * All document generation should go through the DocumentCompiler.
 */

export { DocumentCompiler, getDefaultCompiler } from "./compiler";
export type { CompilerInput, CompilerTextInput, CompilerOutput, CompilerFormat } from "./compiler";

export { DocumentEngine, LayoutEngine, DesignTokensSchema } from "./documentEngine";
export type {
  DesignTokens,
  PresentationSpec,
  DocumentSpec,
  WorkbookSpec,
  LayoutBox,
} from "./documentEngine";

export { resolveTheme, THEMES } from "./themes";

export {
  markdownToDocSpec,
  csvToWorkbookSpec,
  jsonToPresentationSpec,
  markdownToPresentationSpec,
} from "./textToSpec";

export {
  PresentationValidator,
  DocumentValidator,
  WorkbookValidator,
} from "./documentValidators";
export type { ValidationResult, ValidationIssue } from "./documentValidators";
