/**
 * Slack Integration Service - ILIAGPT PRO 3.0
 * 
 * Enables ILIAGPT as a Slack bot for team collaboration.
 * Supports DMs, channel mentions, and thread responses.
 */

// ============== Types ==============

export interface SlackConfig {
    botToken: string;
    signingSecret: string;
    appId: string;
    teamId?: string;
    webhookUrl?: string;
}

export interface SlackMessage {
    channelId: string;
    userId: string;
    text: string;
    threadTs?: string;
    blocks?: SlackBlock[];
    attachments?: SlackAttachment[];
}

export interface SlackBlock {
    type: "section" | "divider" | "context" | "actions" | "header";
    text?: { type: "mrkdwn" | "plain_text"; text: string };
    accessory?: any;
    elements?: any[];
}

export interface SlackAttachment {
    color?: string;
    title?: string;
    text?: string;
    fields?: { title: string; value: string; short?: boolean }[];
    footer?: string;
}

export interface SlackEvent {
    type: string;
    channel: string;
    user: string;
    text: string;
    ts: string;
    thread_ts?: string;
    files?: any[];
}

export interface SlackUser {
    id: string;
    name: string;
    realName: string;
    email?: string;
    isAdmin: boolean;
    teamId: string;
}

// ============== Mock HTTP Client ==============

async function slackAPI(
    endpoint: string,
    method: "GET" | "POST" = "POST",
    body?: any,
    token?: string
): Promise<any> {
    // In production, use actual HTTP client
    console.log(`[Slack API] ${method} ${endpoint}`, body);
    return { ok: true };
}

// ============== Slack Service ==============

export class SlackIntegration {
    private config: SlackConfig | null = null;
    private connected = false;
    private messageHandlers: Map<string, (event: SlackEvent) => Promise<void>> = new Map();

    /**
     * Connect to Slack
     */
    async connect(config: SlackConfig): Promise<boolean> {
        this.config = config;

        try {
            // Test connection
            const response = await slackAPI("auth.test", "POST", {}, config.botToken);

            if (response.ok) {
                this.connected = true;
                console.log("[Slack] Connected successfully");
                return true;
            }
        } catch (error) {
            console.error("[Slack] Connection failed:", error);
        }

        return false;
    }

    /**
     * Check if connected
     */
    isConnected(): boolean {
        return this.connected;
    }

    // ======== Messaging ========

    /**
     * Send a message
     */
    async sendMessage(
        channelId: string,
        text: string,
        options: {
            threadTs?: string;
            blocks?: SlackBlock[];
            attachments?: SlackAttachment[];
            unfurlLinks?: boolean;
        } = {}
    ): Promise<{ ok: boolean; ts?: string; error?: string }> {
        if (!this.connected || !this.config) {
            return { ok: false, error: "Not connected" };
        }

        const payload: any = {
            channel: channelId,
            text,
            unfurl_links: options.unfurlLinks ?? false,
        };

        if (options.threadTs) payload.thread_ts = options.threadTs;
        if (options.blocks) payload.blocks = options.blocks;
        if (options.attachments) payload.attachments = options.attachments;

        const response = await slackAPI("chat.postMessage", "POST", payload, this.config.botToken);

        return {
            ok: response.ok,
            ts: response.ts,
            error: response.error,
        };
    }

    /**
     * Update a message
     */
    async updateMessage(
        channelId: string,
        ts: string,
        text: string,
        blocks?: SlackBlock[]
    ): Promise<boolean> {
        if (!this.connected || !this.config) return false;

        const payload: any = {
            channel: channelId,
            ts,
            text,
        };

        if (blocks) payload.blocks = blocks;

        const response = await slackAPI("chat.update", "POST", payload, this.config.botToken);
        return response.ok;
    }

    /**
     * Delete a message
     */
    async deleteMessage(channelId: string, ts: string): Promise<boolean> {
        if (!this.connected || !this.config) return false;

        const response = await slackAPI("chat.delete", "POST", {
            channel: channelId,
            ts,
        }, this.config.botToken);

        return response.ok;
    }

    /**
     * Add reaction
     */
    async addReaction(channelId: string, ts: string, emoji: string): Promise<boolean> {
        if (!this.connected || !this.config) return false;

        const response = await slackAPI("reactions.add", "POST", {
            channel: channelId,
            timestamp: ts,
            name: emoji,
        }, this.config.botToken);

        return response.ok;
    }

    // ======== Rich Messages ========

    /**
     * Send AI response with formatting
     */
    async sendAIResponse(
        channelId: string,
        response: string,
        options: {
            threadTs?: string;
            model?: string;
            processingTime?: number;
        } = {}
    ): Promise<boolean> {
        const blocks: SlackBlock[] = [
            {
                type: "section",
                text: { type: "mrkdwn", text: response },
            },
        ];

        // Add footer with metadata
        if (options.model || options.processingTime) {
            blocks.push({ type: "divider" });
            blocks.push({
                type: "context",
                elements: [
                    {
                        type: "mrkdwn",
                        text: [
                            options.model ? `🤖 ${options.model}` : "",
                            options.processingTime ? `⏱️ ${options.processingTime}ms` : "",
                        ].filter(Boolean).join(" • "),
                    },
                ],
            });
        }

        const result = await this.sendMessage(channelId, response, {
            threadTs: options.threadTs,
            blocks,
        });

        return result.ok;
    }

    /**
     * Send error message
     */
    async sendError(
        channelId: string,
        error: string,
        threadTs?: string
    ): Promise<boolean> {
        const result = await this.sendMessage(channelId, error, {
            threadTs,
            attachments: [{
                color: "#F44336",
                text: `❌ ${error}`,
            }],
        });

        return result.ok;
    }

    /**
     * Send thinking indicator
     */
    async sendThinking(channelId: string, threadTs?: string): Promise<string | null> {
        const result = await this.sendMessage(channelId, "⏳ Pensando...", { threadTs });
        return result.ts || null;
    }

    // ======== User & Channel Info ========

    /**
     * Get user info
     */
    async getUserInfo(userId: string): Promise<SlackUser | null> {
        if (!this.connected || !this.config) return null;

        const response = await slackAPI("users.info", "POST", {
            user: userId,
        }, this.config.botToken);

        if (!response.ok || !response.user) return null;

        return {
            id: response.user.id,
            name: response.user.name,
            realName: response.user.real_name,
            email: response.user.profile?.email,
            isAdmin: response.user.is_admin,
            teamId: response.user.team_id,
        };
    }

    /**
     * Get channel info
     */
    async getChannelInfo(channelId: string): Promise<{
        id: string;
        name: string;
        isPrivate: boolean;
        memberCount: number;
    } | null> {
        if (!this.connected || !this.config) return null;

        const response = await slackAPI("conversations.info", "POST", {
            channel: channelId,
        }, this.config.botToken);

        if (!response.ok || !response.channel) return null;

        return {
            id: response.channel.id,
            name: response.channel.name,
            isPrivate: response.channel.is_private,
            memberCount: response.channel.num_members,
        };
    }

    // ======== Event Handling ========

    /**
     * Handle incoming event
     */
    async handleEvent(event: SlackEvent): Promise<void> {
        const handler = this.messageHandlers.get(event.type);
        if (handler) {
            await handler(event);
        }
    }

    /**
     * Register message handler
     */
    onMessage(handler: (event: SlackEvent) => Promise<void>): void {
        this.messageHandlers.set("message", handler);
    }

    /**
     * Register mention handler
     */
    onMention(handler: (event: SlackEvent) => Promise<void>): void {
        this.messageHandlers.set("app_mention", handler);
    }

    /**
     * Verify Slack signature
     */
    verifySignature(
        signature: string,
        timestamp: string,
        body: string
    ): boolean {
        if (!this.config) return false;

        // In production, use HMAC-SHA256 verification
        // const sigBasestring = `v0:${timestamp}:${body}`;
        // const mySignature = 'v0=' + crypto.createHmac('sha256', this.config.signingSecret)
        //   .update(sigBasestring).digest('hex');
        // return crypto.timingSafeEqual(Buffer.from(mySignature), Buffer.from(signature));

        return true; // Simplified for demo
    }

    // ======== Slash Commands ========

    /**
     * Register slash command handler
     */
    onSlashCommand(
        command: string,
        handler: (payload: {
            userId: string;
            channelId: string;
            text: string;
            responseUrl: string;
        }) => Promise<string>
    ): void {
        // In production, this would register with Slack's API
        console.log(`[Slack] Registered slash command: /${command}`);
    }

    // ======== Webhook ========

    /**
     * Send webhook notification
     */
    async sendWebhook(
        text: string,
        blocks?: SlackBlock[]
    ): Promise<boolean> {
        if (!this.config?.webhookUrl) return false;

        const payload: any = { text };
        if (blocks) payload.blocks = blocks;

        try {
            // In production, POST to webhook URL
            console.log("[Slack] Webhook sent:", text);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Disconnect
     */
    disconnect(): void {
        this.connected = false;
        this.config = null;
        this.messageHandlers.clear();
        console.log("[Slack] Disconnected");
    }
}

// ============== Singleton ==============

let slackInstance: SlackIntegration | null = null;

export function getSlackIntegration(): SlackIntegration {
    if (!slackInstance) {
        slackInstance = new SlackIntegration();
    }
    return slackInstance;
}

export default SlackIntegration;
