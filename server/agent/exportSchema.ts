import { AgentTaskSchema } from "./contracts";
import zodToJsonSchema from "zod-to-json-schema";
import fs from "fs";
import path from "path";

const jsonSchema = zodToJsonSchema(AgentTaskSchema, "AgentTask");
const outputPath = "./server/agent/agentTaskContract.json";

fs.writeFileSync(outputPath, JSON.stringify(jsonSchema, null, 2));
console.log(`AgentTaskSchema exported to ${outputPath}`);
