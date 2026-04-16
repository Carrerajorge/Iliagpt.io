import { toolRegistry } from "../registry";
import { webNavigateTool } from "./web-navigate";
import { extractContentTool } from "./extract-content";
import { generateFileTool } from "./generate-file";
import { transformDataTool } from "./transform-data";
import { respondTool } from "./respond";
import { searchWebTool } from "./search-web";
import { analyzeDataTool } from "./analyze-data";
import { shellExecuteTool } from "./shell-execute";
import { fileOperationsTool } from "./file-operations";
import { generateCodeTool } from "./generate-code";
import { webdevScaffoldTool } from "./webdev-scaffold";
import { slidesGenerateTool } from "./slides-generate";

export function registerBuiltinTools(): void {
  toolRegistry.register(webNavigateTool);
  toolRegistry.register(extractContentTool);
  toolRegistry.register(generateFileTool);
  toolRegistry.register(transformDataTool);
  toolRegistry.register(respondTool);
  toolRegistry.register(searchWebTool);
  toolRegistry.register(analyzeDataTool);
  toolRegistry.register(shellExecuteTool);
  toolRegistry.register(fileOperationsTool);
  toolRegistry.register(generateCodeTool);
  toolRegistry.register(webdevScaffoldTool);
  toolRegistry.register(slidesGenerateTool);
  
  console.log(`Registered ${toolRegistry.getAll().length} built-in tools`);
}

export * from "./web-navigate";
export * from "./extract-content";
export * from "./generate-file";
export * from "./transform-data";
export * from "./respond";
export * from "./search-web";
export * from "./analyze-data";
export * from "./shell-execute";
export * from "./file-operations";
export * from "./generate-code";
export * from "./webdev-scaffold";
export * from "./slides-generate";
