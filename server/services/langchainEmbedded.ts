import { PromptTemplate } from "@langchain/core/prompts";

export type LangChainPromptFormatInput = {
  template: string;
  variables?: Record<string, unknown>;
};

export type LangChainPromptFormatOutput = {
  text: string;
  variables: string[];
};

export async function formatLangChainPrompt(
  input: LangChainPromptFormatInput,
): Promise<LangChainPromptFormatOutput> {
  const template = String(input.template ?? "").trim();
  if (!template) {
    throw new Error("LangChain prompt template is required");
  }

  const prompt = PromptTemplate.fromTemplate(template);
  const vars = input.variables ?? {};
  try {
    const text = await prompt.format(vars as Record<string, string>);
    return {
      text,
      variables: prompt.inputVariables ?? Object.keys(vars),
    };
  } catch (error: any) {
    const message = error?.message ? String(error.message) : String(error);
    throw new Error(`LangChain prompt format failed: ${message}`);
  }
}
