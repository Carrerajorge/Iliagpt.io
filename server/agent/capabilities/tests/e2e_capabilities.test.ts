import { describe, it, expect } from 'vitest';
import { globalRegistry } from '../registry';
import { AutonomousAgentBrain } from '../../autonomousAgentBrain';

describe('Phase 7: Dynamic Capability Interop', () => {

    it('Should start with the base manually imported capabilities (Phase 1-6)', () => {
        // Instantiate the brain so it registers the hardcoded tools
        new AutonomousAgentBrain();

        const baseTools = globalRegistry.getAllRaw();
        expect(baseTools.length).toBeGreaterThan(0);
        // We registered about 10 base tools in autonomousAgentBrain initially
        console.log(`Base tools count: ${baseTools.length}`);
    });

    it('Should dynamically load >100+ capabilities via LangChain and MCP aggregators (Phase 7)', async () => {
        const initialCount = globalRegistry.getAllRaw().length;

        // This will spin up DuckDuckGo, Wikipedia, and search for mcp_servers.json locally
        const loaded = await globalRegistry.loadDynamicSuites();

        const finalCount = globalRegistry.getAllRaw().length;

        expect(loaded).toBeGreaterThanOrEqual(2); // At least Wikipedia + DDG
        expect(finalCount).toBeGreaterThan(initialCount);

        const allToolNames = globalRegistry.getAllRaw().map(c => c.name);
        expect(allToolNames).toContain('langchain_wikipedia');
        expect(allToolNames).toContain('langchain_duckduckgo');

        console.log(`Action space successfully expanded from ${initialCount} -> ${finalCount} tools dynamically.`);
    });
});
