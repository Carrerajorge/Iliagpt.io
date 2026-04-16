/**
 * Claw Agent System — TypeScript rewrite of claw-code capabilities
 *
 * Provides a self-contained agent loop with terminal, file, browser,
 * search, code execution, universal tool calling, session persistence,
 * and permission enforcement.
 */

export { ClawAgentLoop } from './agentLoop';
export type { ClawAgentOptions, ClawAgentResult, ClawTool, StepResult } from './agentLoop';

export { executeCommand, validateCommand, TERMINAL_TOOL_DEFINITION } from './terminalTool';
export { executeFileOp, FILE_TOOL_DEFINITION } from './fileTool';
export { BrowserTool, BROWSER_TOOL_DEFINITION } from './browserTool';
export { webSearch, fetchUrl, SEARCH_TOOL_DEFINITION } from './searchTool';
export { executeCode, CODE_EXECUTOR_TOOL_DEFINITION } from './codeExecutor';
export { UniversalToolAdapter, universalToolAdapter } from './universalToolCalling';
export { ClawSessionManager, clawSessionManager } from './sessionManager';
export { ClawPermissionEnforcer, permissionEnforcer } from './permissionSystem';
