import { z } from "zod";
import OpenAI from "openai";
import { BaseAgent, BaseAgentConfig, AgentTask, AgentResult, AgentCapability } from "./types";

const xaiClient = new OpenAI({
  baseURL: "https://api.x.ai/v1",
  apiKey: process.env.XAI_API_KEY || "missing",
});

const DEFAULT_MODEL = "grok-4-1-fast-non-reasoning";

export class CommunicationAgent extends BaseAgent {
  constructor() {
    const config: BaseAgentConfig = {
      name: "CommunicationAgent",
      description: "Specialized agent for email composition, notifications, messaging, and communication management. Expert at crafting effective communications.",
      model: DEFAULT_MODEL,
      temperature: 0.5,
      maxTokens: 4096,
      systemPrompt: `You are the CommunicationAgent - an expert in professional communication.

Your capabilities:
1. Email Composition: Professional emails, newsletters, sequences
2. Notifications: Push notifications, alerts, reminders
3. Messaging: Chat responses, SMS, support tickets
4. Templates: Reusable communication templates
5. Scheduling: Optimal send time recommendations
6. Analytics: Communication effectiveness insights

Communication principles:
- Clear and concise messaging
- Appropriate tone for context
- Strong subject lines
- Effective calls to action
- Personalization when possible
- Accessibility considerations

Best practices:
- GDPR/CAN-SPAM compliance
- Mobile-friendly formatting
- A/B testing suggestions
- Follow-up sequences
- Response tracking`,
      tools: ["email_send", "notification_push", "message"],
      timeout: 60000,
      maxIterations: 10,
    };
    super(config);
  }

  async execute(task: AgentTask): Promise<AgentResult> {
    const startTime = Date.now();
    this.updateState({ status: "running", currentTask: task.description, startedAt: new Date().toISOString() });

    try {
      const commType = this.determineCommunicationType(task);
      let result: any;

      switch (commType) {
        case "email":
          result = await this.composeEmail(task);
          break;
        case "notification":
          result = await this.createNotification(task);
          break;
        case "message":
          result = await this.composeMessage(task);
          break;
        case "template":
          result = await this.createTemplate(task);
          break;
        default:
          result = await this.handleGeneralCommunication(task);
      }

      this.updateState({ status: "completed", progress: 100, completedAt: new Date().toISOString() });

      return {
        taskId: task.id,
        agentId: this.state.id,
        success: true,
        output: result,
        duration: Date.now() - startTime,
      };
    } catch (error: any) {
      this.updateState({ status: "failed", error: error.message });
      return {
        taskId: task.id,
        agentId: this.state.id,
        success: false,
        error: error.message,
        duration: Date.now() - startTime,
      };
    }
  }

  private determineCommunicationType(task: AgentTask): string {
    const description = task.description.toLowerCase();
    if (description.includes("email")) return "email";
    if (description.includes("notification") || description.includes("alert")) return "notification";
    if (description.includes("message") || description.includes("chat") || description.includes("sms")) return "message";
    if (description.includes("template")) return "template";
    return "general";
  }

  private async composeEmail(task: AgentTask): Promise<any> {
    const purpose = task.input.purpose || task.description;
    const recipient = task.input.recipient || "recipient";
    const tone = task.input.tone || "professional";

    const response = await xaiClient.chat.completions.create({
      model: this.config.model,
      messages: [
        { role: "system", content: this.config.systemPrompt },
        {
          role: "user",
          content: `Compose an email:
Purpose: ${purpose}
Recipient: ${recipient}
Tone: ${tone}
Additional context: ${JSON.stringify(task.input)}

Return JSON:
{
  "subject": "compelling subject line",
  "subjectAlternatives": ["2 more options"],
  "greeting": "appropriate greeting",
  "body": "email body with proper paragraphs",
  "closing": "professional closing",
  "signature": "signature block",
  "tips": ["best time to send", "follow-up suggestions"]
}`,
        },
      ],
      temperature: 0.5,
    });

    const content = response.choices[0].message.content || "{}";
    const jsonMatch = content.match(/\{[\s\S]*\}/);

    return {
      type: "email",
      email: jsonMatch ? JSON.parse(jsonMatch[0]) : { body: content },
      timestamp: new Date().toISOString(),
    };
  }

  private async createNotification(task: AgentTask): Promise<any> {
    const type = task.input.type || "push";
    const message = task.input.message || task.description;

    const response = await xaiClient.chat.completions.create({
      model: this.config.model,
      messages: [
        { role: "system", content: this.config.systemPrompt },
        {
          role: "user",
          content: `Create a ${type} notification:
Message: ${message}
Context: ${JSON.stringify(task.input)}

Return JSON:
{
  "title": "notification title (max 50 chars)",
  "body": "notification body (max 100 chars)",
  "icon": "suggested icon name",
  "action": {"text": "button text", "url": "action url"},
  "priority": "low|normal|high",
  "variations": [{"title": "", "body": ""}]
}`,
        },
      ],
      temperature: 0.4,
    });

    const content = response.choices[0].message.content || "{}";
    const jsonMatch = content.match(/\{[\s\S]*\}/);

    return {
      type: "notification",
      notification: jsonMatch ? JSON.parse(jsonMatch[0]) : { body: content },
      timestamp: new Date().toISOString(),
    };
  }

  private async composeMessage(task: AgentTask): Promise<any> {
    const platform = task.input.platform || "chat";
    const context = task.input.context || task.description;

    const response = await xaiClient.chat.completions.create({
      model: this.config.model,
      messages: [
        { role: "system", content: this.config.systemPrompt },
        {
          role: "user",
          content: `Compose a message for ${platform}:
Context: ${context}
Details: ${JSON.stringify(task.input)}

Provide appropriate message with variations.`,
        },
      ],
      temperature: 0.5,
    });

    return {
      type: "message",
      platform,
      message: response.choices[0].message.content,
      timestamp: new Date().toISOString(),
    };
  }

  private async createTemplate(task: AgentTask): Promise<any> {
    const templateType = task.input.templateType || "email";
    const purpose = task.input.purpose || task.description;

    const response = await xaiClient.chat.completions.create({
      model: this.config.model,
      messages: [
        { role: "system", content: this.config.systemPrompt },
        {
          role: "user",
          content: `Create a ${templateType} template for: ${purpose}

Return JSON:
{
  "name": "template name",
  "type": "${templateType}",
  "template": "template with {{placeholders}}",
  "placeholders": [{"name": "", "description": "", "example": ""}],
  "usageTips": ["when to use this template"],
  "variations": []
}`,
        },
      ],
      temperature: 0.5,
    });

    const content = response.choices[0].message.content || "{}";
    const jsonMatch = content.match(/\{[\s\S]*\}/);

    return {
      type: "template",
      template: jsonMatch ? JSON.parse(jsonMatch[0]) : { content },
      timestamp: new Date().toISOString(),
    };
  }

  private async handleGeneralCommunication(task: AgentTask): Promise<any> {
    const response = await xaiClient.chat.completions.create({
      model: this.config.model,
      messages: [
        { role: "system", content: this.config.systemPrompt },
        { role: "user", content: `Communication task: ${task.description}\nInput: ${JSON.stringify(task.input)}` },
      ],
      temperature: 0.5,
    });

    return {
      type: "general_communication",
      result: response.choices[0].message.content,
      timestamp: new Date().toISOString(),
    };
  }

  getCapabilities(): AgentCapability[] {
    return [
      {
        name: "compose_email",
        description: "Compose professional emails",
        inputSchema: z.object({ purpose: z.string(), recipient: z.string().optional(), tone: z.string().optional() }),
        outputSchema: z.object({ subject: z.string(), body: z.string() }),
      },
      {
        name: "create_notification",
        description: "Create push notifications and alerts",
        inputSchema: z.object({ message: z.string(), type: z.string().optional() }),
        outputSchema: z.object({ title: z.string(), body: z.string() }),
      },
    ];
  }
}

export const communicationAgent = new CommunicationAgent();
