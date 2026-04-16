import { ToolDefinition, ToolCategory, ValidationResult } from "./types";

class ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map();
  private categoryIndex: Map<ToolCategory, Set<string>> = new Map();
  private capabilityIndex: Map<string, Set<string>> = new Map();

  register(tool: ToolDefinition): void {
    if (this.tools.has(tool.id)) {
      console.warn(`Tool ${tool.id} already registered, overwriting...`);
    }
    
    this.tools.set(tool.id, tool);
    
    if (!this.categoryIndex.has(tool.category)) {
      this.categoryIndex.set(tool.category, new Set());
    }
    this.categoryIndex.get(tool.category)!.add(tool.id);
    
    for (const capability of tool.capabilities) {
      if (!this.capabilityIndex.has(capability)) {
        this.capabilityIndex.set(capability, new Set());
      }
      this.capabilityIndex.get(capability)!.add(tool.id);
    }
    
    console.log(`Registered tool: ${tool.id} (${tool.category})`);
  }

  unregister(toolId: string): boolean {
    const tool = this.tools.get(toolId);
    if (!tool) return false;
    
    this.tools.delete(toolId);
    this.categoryIndex.get(tool.category)?.delete(toolId);
    for (const capability of tool.capabilities) {
      this.capabilityIndex.get(capability)?.delete(toolId);
    }
    
    return true;
  }

  get(toolId: string): ToolDefinition | undefined {
    return this.tools.get(toolId);
  }

  getByCategory(category: ToolCategory): ToolDefinition[] {
    const toolIds = this.categoryIndex.get(category) || new Set();
    return Array.from(toolIds).map(id => this.tools.get(id)!).filter(Boolean);
  }

  getByCapability(capability: string): ToolDefinition[] {
    const toolIds = this.capabilityIndex.get(capability) || new Set();
    return Array.from(toolIds).map(id => this.tools.get(id)!).filter(Boolean);
  }

  findBestMatch(requirements: string[]): ToolDefinition | undefined {
    let bestMatch: ToolDefinition | undefined;
    let bestScore = 0;

    for (const tool of Array.from(this.tools.values())) {
      const score = requirements.filter(req => 
        tool.capabilities.includes(req) || 
        tool.description.toLowerCase().includes(req.toLowerCase())
      ).length;
      
      if (score > bestScore) {
        bestScore = score;
        bestMatch = tool;
      }
    }

    return bestMatch;
  }

  getAll(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  getToolManifest(): { id: string; name: string; description: string; category: ToolCategory; capabilities: string[] }[] {
    return this.getAll().map(tool => ({
      id: tool.id,
      name: tool.name,
      description: tool.description,
      category: tool.category,
      capabilities: tool.capabilities
    }));
  }

  validateToolParams(toolId: string, params: Record<string, any>): ValidationResult {
    const tool = this.tools.get(toolId);
    if (!tool) {
      return { valid: false, errors: [`Tool ${toolId} not found`] };
    }

    if (tool.validate) {
      return tool.validate(params);
    }

    const errors: string[] = [];
    const warnings: string[] = [];

    for (const [paramName, schema] of Object.entries(tool.inputSchema)) {
      const value = params[paramName];
      
      if (schema.required && (value === undefined || value === null)) {
        errors.push(`Required parameter '${paramName}' is missing`);
        continue;
      }

      if (value !== undefined && value !== null) {
        const expectedType = schema.type;
        const actualType = Array.isArray(value) ? "array" : typeof value;
        
        if (expectedType !== actualType) {
          errors.push(`Parameter '${paramName}' expected ${expectedType}, got ${actualType}`);
        }

        if (schema.enum && !schema.enum.includes(value)) {
          errors.push(`Parameter '${paramName}' must be one of: ${schema.enum.join(", ")}`);
        }
      }
    }

    return { valid: errors.length === 0, errors, warnings };
  }
}

export const toolRegistry = new ToolRegistry();
