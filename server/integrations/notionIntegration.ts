/**
 * Notion Integration Service - ILIAGPT PRO 3.0
 * 
 * Sync with Notion for notes and knowledge base.
 * Bi-directional page and database sync.
 */

// ============== Types ==============

export interface NotionConfig {
    accessToken: string;
    workspaceId?: string;
}

export interface NotionPage {
    id: string;
    title: string;
    url: string;
    icon?: string;
    cover?: string;
    parentId?: string;
    parentType: "workspace" | "page" | "database";
    lastEdited: Date;
    createdTime: Date;
    properties?: Record<string, any>;
}

export interface NotionDatabase {
    id: string;
    title: string;
    url: string;
    icon?: string;
    properties: NotionProperty[];
}

export interface NotionProperty {
    id: string;
    name: string;
    type: NotionPropertyType;
    options?: { id: string; name: string; color: string }[];
}

export type NotionPropertyType =
    | "title"
    | "rich_text"
    | "number"
    | "select"
    | "multi_select"
    | "date"
    | "checkbox"
    | "url"
    | "email"
    | "phone_number"
    | "relation"
    | "formula";

export interface NotionBlock {
    id: string;
    type: string;
    content: string;
    children?: NotionBlock[];
}

export interface SyncConfig {
    direction: "notion_to_iliagpt" | "iliagpt_to_notion" | "bidirectional";
    autoSync: boolean;
    syncInterval: number;
    includeSubpages: boolean;
}

// ============== Notion Service ==============

export class NotionIntegration {
    private config: NotionConfig | null = null;
    private connected = false;
    private syncStatus: Map<string, { lastSync: Date; status: "synced" | "pending" | "error" }> = new Map();

    /**
     * Connect to Notion
     */
    async connect(config: NotionConfig): Promise<boolean> {
        this.config = config;

        try {
            // Test connection
            const response = await this.api("users/me");

            if (response.id) {
                this.connected = true;
                console.log("[Notion] Connected as", response.name);
                return true;
            }
        } catch (error) {
            console.error("[Notion] Connection failed:", error);
        }

        return false;
    }

    isConnected(): boolean {
        return this.connected;
    }

    // ======== Pages ========

    /**
     * Search pages
     */
    async searchPages(query: string): Promise<NotionPage[]> {
        if (!this.connected) return [];

        const response = await this.api("search", "POST", {
            query,
            filter: { property: "object", value: "page" },
            sort: { direction: "descending", timestamp: "last_edited_time" },
        });

        return (response.results || []).map(this.mapPage);
    }

    /**
     * Get page content
     */
    async getPageContent(pageId: string): Promise<{
        page: NotionPage;
        blocks: NotionBlock[];
    } | null> {
        if (!this.connected) return null;

        const [page, blocks] = await Promise.all([
            this.api(`pages/${pageId}`),
            this.api(`blocks/${pageId}/children`),
        ]);

        return {
            page: this.mapPage(page),
            blocks: (blocks.results || []).map(this.mapBlock),
        };
    }

    /**
     * Create page
     */
    async createPage(
        parentId: string,
        title: string,
        content: string,
        isDatabase: boolean = false
    ): Promise<NotionPage | null> {
        if (!this.connected) return null;

        const parent = isDatabase
            ? { database_id: parentId }
            : { page_id: parentId };

        const properties = isDatabase
            ? { Name: { title: [{ text: { content: title } }] } }
            : { title: { title: [{ text: { content: title } }] } };

        const children = this.markdownToBlocks(content);

        const response = await this.api("pages", "POST", {
            parent,
            properties,
            children,
        });

        return response ? this.mapPage(response) : null;
    }

    /**
     * Update page
     */
    async updatePage(pageId: string, content: string): Promise<boolean> {
        if (!this.connected) return false;

        // Delete existing blocks
        const existing = await this.api(`blocks/${pageId}/children`);
        for (const block of existing.results || []) {
            await this.api(`blocks/${block.id}`, "DELETE");
        }

        // Add new blocks
        const children = this.markdownToBlocks(content);
        await this.api(`blocks/${pageId}/children`, "PATCH", { children });

        return true;
    }

    /**
     * Delete page
     */
    async archivePage(pageId: string): Promise<boolean> {
        if (!this.connected) return false;

        await this.api(`pages/${pageId}`, "PATCH", { archived: true });
        return true;
    }

    // ======== Databases ========

    /**
     * List databases
     */
    async listDatabases(): Promise<NotionDatabase[]> {
        if (!this.connected) return [];

        const response = await this.api("search", "POST", {
            filter: { property: "object", value: "database" },
        });

        return (response.results || []).map(this.mapDatabase);
    }

    /**
     * Query database
     */
    async queryDatabase(
        databaseId: string,
        filter?: any,
        sorts?: any[]
    ): Promise<NotionPage[]> {
        if (!this.connected) return [];

        const response = await this.api(`databases/${databaseId}/query`, "POST", {
            filter,
            sorts,
        });

        return (response.results || []).map(this.mapPage);
    }

    // ======== Sync ========

    /**
     * Sync page to ILIAGPT
     */
    async syncToMichat(pageId: string): Promise<{
        title: string;
        content: string;
        metadata: Record<string, any>;
    } | null> {
        const data = await this.getPageContent(pageId);
        if (!data) return null;

        const content = this.blocksToMarkdown(data.blocks);

        this.syncStatus.set(pageId, { lastSync: new Date(), status: "synced" });

        return {
            title: data.page.title,
            content,
            metadata: {
                notionPageId: pageId,
                notionUrl: data.page.url,
                lastEdited: data.page.lastEdited,
            },
        };
    }

    /**
     * Sync from ILIAGPT to Notion
     */
    async syncFromMichat(
        parentId: string,
        title: string,
        content: string,
        existingPageId?: string
    ): Promise<NotionPage | null> {
        if (existingPageId) {
            const success = await this.updatePage(existingPageId, content);
            if (success) {
                this.syncStatus.set(existingPageId, { lastSync: new Date(), status: "synced" });
                return this.mapPage(await this.api(`pages/${existingPageId}`));
            }
            return null;
        }

        const page = await this.createPage(parentId, title, content);
        if (page) {
            this.syncStatus.set(page.id, { lastSync: new Date(), status: "synced" });
        }
        return page;
    }

    /**
     * Get sync status
     */
    getSyncStatus(pageId: string) {
        return this.syncStatus.get(pageId);
    }

    // ======== Helpers ========

    private async api(
        endpoint: string,
        method: "GET" | "POST" | "PATCH" | "DELETE" = "GET",
        body?: any
    ): Promise<any> {
        // In production, use actual HTTP client
        console.log(`[Notion API] ${method} ${endpoint}`, body);

        // Mock response
        return { id: "mock-id", results: [] };
    }

    private mapPage = (p: any): NotionPage => ({
        id: p.id,
        title: p.properties?.title?.title?.[0]?.plain_text ||
            p.properties?.Name?.title?.[0]?.plain_text || "Untitled",
        url: p.url,
        icon: p.icon?.emoji,
        cover: p.cover?.external?.url || p.cover?.file?.url,
        parentId: p.parent?.page_id || p.parent?.database_id,
        parentType: p.parent?.type || "workspace",
        lastEdited: new Date(p.last_edited_time),
        createdTime: new Date(p.created_time),
        properties: p.properties,
    });

    private mapDatabase = (d: any): NotionDatabase => ({
        id: d.id,
        title: d.title?.[0]?.plain_text || "Untitled",
        url: d.url,
        icon: d.icon?.emoji,
        properties: Object.entries(d.properties || {}).map(([name, prop]: [string, any]) => ({
            id: prop.id,
            name,
            type: prop.type,
            options: prop.select?.options || prop.multi_select?.options,
        })),
    });

    private mapBlock = (b: any): NotionBlock => ({
        id: b.id,
        type: b.type,
        content: this.extractBlockContent(b),
        children: b.children?.map(this.mapBlock),
    });

    private extractBlockContent(block: any): string {
        const type = block.type;
        const content = block[type];

        if (content?.rich_text) {
            return content.rich_text.map((t: any) => t.plain_text).join("");
        }
        if (content?.caption) {
            return content.caption.map((t: any) => t.plain_text).join("");
        }
        return "";
    }

    private markdownToBlocks(markdown: string): any[] {
        const lines = markdown.split("\n");
        const blocks: any[] = [];

        for (const line of lines) {
            if (line.startsWith("# ")) {
                blocks.push({
                    type: "heading_1",
                    heading_1: { rich_text: [{ text: { content: line.slice(2) } }] },
                });
            } else if (line.startsWith("## ")) {
                blocks.push({
                    type: "heading_2",
                    heading_2: { rich_text: [{ text: { content: line.slice(3) } }] },
                });
            } else if (line.startsWith("- ")) {
                blocks.push({
                    type: "bulleted_list_item",
                    bulleted_list_item: { rich_text: [{ text: { content: line.slice(2) } }] },
                });
            } else if (line.startsWith("```")) {
                // Simplified code block handling
                continue;
            } else if (line.trim()) {
                blocks.push({
                    type: "paragraph",
                    paragraph: { rich_text: [{ text: { content: line } }] },
                });
            }
        }

        return blocks;
    }

    private blocksToMarkdown(blocks: NotionBlock[]): string {
        return blocks.map(block => {
            switch (block.type) {
                case "heading_1": return `# ${block.content}`;
                case "heading_2": return `## ${block.content}`;
                case "heading_3": return `### ${block.content}`;
                case "bulleted_list_item": return `- ${block.content}`;
                case "numbered_list_item": return `1. ${block.content}`;
                case "code": return `\`\`\`\n${block.content}\n\`\`\``;
                default: return block.content;
            }
        }).join("\n\n");
    }

    disconnect(): void {
        this.connected = false;
        this.config = null;
        this.syncStatus.clear();
    }
}

// ============== Singleton ==============

let notionInstance: NotionIntegration | null = null;

export function getNotionIntegration(): NotionIntegration {
    if (!notionInstance) {
        notionInstance = new NotionIntegration();
    }
    return notionInstance;
}

export default NotionIntegration;
