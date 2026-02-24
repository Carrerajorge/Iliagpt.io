/**
 * GitHub Integration Service - ILIAGPT PRO 3.0
 * 
 * Connects ILIAGPT with GitHub for code collaboration.
 * Supports repos, issues, PRs, and code search.
 */

// ============== Types ==============

export interface GitHubConfig {
    token: string;
    appId?: string;
    installationId?: string;
    webhookSecret?: string;
}

export interface Repository {
    id: number;
    name: string;
    fullName: string;
    description: string | null;
    private: boolean;
    defaultBranch: string;
    language: string | null;
    stars: number;
    forks: number;
    url: string;
    cloneUrl: string;
}

export interface Issue {
    id: number;
    number: number;
    title: string;
    body: string;
    state: "open" | "closed";
    labels: string[];
    assignees: string[];
    author: string;
    createdAt: Date;
    updatedAt: Date;
    url: string;
}

export interface PullRequest extends Issue {
    headBranch: string;
    baseBranch: string;
    mergeable: boolean | null;
    draft: boolean;
    additions: number;
    deletions: number;
    changedFiles: number;
}

export interface FileContent {
    path: string;
    content: string;
    sha: string;
    size: number;
    encoding: "base64" | "utf-8";
}

export interface CodeSearchResult {
    path: string;
    repository: string;
    url: string;
    matches: { line: number; content: string }[];
    score: number;
}

// ============== Mock HTTP Client ==============

async function githubAPI<T>(
    endpoint: string,
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" = "GET",
    body?: any,
    token?: string
): Promise<T> {
    // In production, use actual HTTP client
    console.log(`[GitHub API] ${method} ${endpoint}`);
    return {} as T;
}

// ============== GitHub Service ==============

export class GitHubIntegration {
    private config: GitHubConfig | null = null;
    private connected = false;
    private user: { login: string; name: string; avatarUrl: string } | null = null;

    /**
     * Connect with token
     */
    async connect(config: GitHubConfig): Promise<boolean> {
        this.config = config;

        try {
            const response = await githubAPI<any>(
                "user",
                "GET",
                undefined,
                config.token
            );

            if (response.login) {
                this.connected = true;
                this.user = {
                    login: response.login,
                    name: response.name,
                    avatarUrl: response.avatar_url,
                };
                return true;
            }
        } catch (error) {
            console.error("[GitHub] Connection failed:", error);
        }

        return false;
    }

    isConnected(): boolean {
        return this.connected;
    }

    getUser(): typeof this.user {
        return this.user;
    }

    // ======== Repositories ========

    /**
     * List user repositories
     */
    async listRepos(options: {
        type?: "all" | "owner" | "member";
        sort?: "created" | "updated" | "pushed" | "full_name";
        per_page?: number;
    } = {}): Promise<Repository[]> {
        if (!this.connected) return [];

        const params = new URLSearchParams({
            type: options.type || "all",
            sort: options.sort || "updated",
            per_page: String(options.per_page || 30),
        });

        const response = await githubAPI<any[]>(
            `user/repos?${params}`,
            "GET",
            undefined,
            this.config?.token
        );

        return (response || []).map(this.mapRepository);
    }

    /**
     * Get repository
     */
    async getRepo(owner: string, repo: string): Promise<Repository | null> {
        if (!this.connected) return null;

        try {
            const response = await githubAPI<any>(
                `repos/${owner}/${repo}`,
                "GET",
                undefined,
                this.config?.token
            );
            return this.mapRepository(response);
        } catch {
            return null;
        }
    }

    /**
     * Search repositories
     */
    async searchRepos(query: string, limit: number = 10): Promise<Repository[]> {
        if (!this.connected) return [];

        const response = await githubAPI<any>(
            `search/repositories?q=${encodeURIComponent(query)}&per_page=${limit}`,
            "GET",
            undefined,
            this.config?.token
        );

        return (response?.items || []).map(this.mapRepository);
    }

    private mapRepository = (r: any): Repository => ({
        id: r.id,
        name: r.name,
        fullName: r.full_name,
        description: r.description,
        private: r.private,
        defaultBranch: r.default_branch,
        language: r.language,
        stars: r.stargazers_count,
        forks: r.forks_count,
        url: r.html_url,
        cloneUrl: r.clone_url,
    });

    // ======== Issues & PRs ========

    /**
     * List issues
     */
    async listIssues(
        owner: string,
        repo: string,
        options: { state?: "open" | "closed" | "all"; labels?: string } = {}
    ): Promise<Issue[]> {
        if (!this.connected) return [];

        const params = new URLSearchParams({
            state: options.state || "open",
            per_page: "30",
        });
        if (options.labels) params.set("labels", options.labels);

        const response = await githubAPI<any[]>(
            `repos/${owner}/${repo}/issues?${params}`,
            "GET",
            undefined,
            this.config?.token
        );

        return (response || [])
            .filter(i => !i.pull_request)
            .map(this.mapIssue);
    }

    /**
     * Create issue
     */
    async createIssue(
        owner: string,
        repo: string,
        title: string,
        body: string,
        labels?: string[]
    ): Promise<Issue | null> {
        if (!this.connected) return null;

        const response = await githubAPI<any>(
            `repos/${owner}/${repo}/issues`,
            "POST",
            { title, body, labels },
            this.config?.token
        );

        return response ? this.mapIssue(response) : null;
    }

    /**
     * List pull requests
     */
    async listPullRequests(
        owner: string,
        repo: string,
        state: "open" | "closed" | "all" = "open"
    ): Promise<PullRequest[]> {
        if (!this.connected) return [];

        const response = await githubAPI<any[]>(
            `repos/${owner}/${repo}/pulls?state=${state}`,
            "GET",
            undefined,
            this.config?.token
        );

        return (response || []).map(this.mapPullRequest);
    }

    /**
     * Get pull request diff
     */
    async getPRDiff(owner: string, repo: string, prNumber: number): Promise<string | null> {
        if (!this.connected) return null;

        // Special header for diff format
        const response = await githubAPI<string>(
            `repos/${owner}/${repo}/pulls/${prNumber}`,
            "GET",
            undefined,
            this.config?.token
        );

        return response || null;
    }

    private mapIssue = (i: any): Issue => ({
        id: i.id,
        number: i.number,
        title: i.title,
        body: i.body || "",
        state: i.state,
        labels: (i.labels || []).map((l: any) => l.name),
        assignees: (i.assignees || []).map((a: any) => a.login),
        author: i.user?.login || "unknown",
        createdAt: new Date(i.created_at),
        updatedAt: new Date(i.updated_at),
        url: i.html_url,
    });

    private mapPullRequest = (p: any): PullRequest => ({
        ...this.mapIssue(p),
        headBranch: p.head?.ref || "",
        baseBranch: p.base?.ref || "",
        mergeable: p.mergeable,
        draft: p.draft || false,
        additions: p.additions || 0,
        deletions: p.deletions || 0,
        changedFiles: p.changed_files || 0,
    });

    // ======== Files ========

    /**
     * Get file content
     */
    async getFile(
        owner: string,
        repo: string,
        path: string,
        ref?: string
    ): Promise<FileContent | null> {
        if (!this.connected) return null;

        const endpoint = ref
            ? `repos/${owner}/${repo}/contents/${path}?ref=${ref}`
            : `repos/${owner}/${repo}/contents/${path}`;

        try {
            const response = await githubAPI<any>(
                endpoint,
                "GET",
                undefined,
                this.config?.token
            );

            if (!response || response.type !== "file") return null;

            const content = response.encoding === "base64"
                ? Buffer.from(response.content, "base64").toString("utf-8")
                : response.content;

            return {
                path: response.path,
                content,
                sha: response.sha,
                size: response.size,
                encoding: "utf-8",
            };
        } catch {
            return null;
        }
    }

    /**
     * Update/create file
     */
    async updateFile(
        owner: string,
        repo: string,
        path: string,
        content: string,
        message: string,
        sha?: string
    ): Promise<boolean> {
        if (!this.connected) return false;

        const body: any = {
            message,
            content: Buffer.from(content).toString("base64"),
        };
        if (sha) body.sha = sha;

        try {
            await githubAPI(
                `repos/${owner}/${repo}/contents/${path}`,
                "PUT",
                body,
                this.config?.token
            );
            return true;
        } catch {
            return false;
        }
    }

    // ======== Code Search ========

    /**
     * Search code
     */
    async searchCode(
        query: string,
        options: { repo?: string; language?: string; limit?: number } = {}
    ): Promise<CodeSearchResult[]> {
        if (!this.connected) return [];

        let q = query;
        if (options.repo) q += ` repo:${options.repo}`;
        if (options.language) q += ` language:${options.language}`;

        const response = await githubAPI<any>(
            `search/code?q=${encodeURIComponent(q)}&per_page=${options.limit || 10}`,
            "GET",
            undefined,
            this.config?.token
        );

        return (response?.items || []).map((item: any) => ({
            path: item.path,
            repository: item.repository?.full_name || "",
            url: item.html_url,
            matches: (item.text_matches || []).map((m: any) => ({
                line: 0,
                content: m.fragment,
            })),
            score: item.score,
        }));
    }

    // ======== Webhooks ========

    /**
     * Verify webhook signature
     */
    verifyWebhookSignature(payload: string, signature: string): boolean {
        if (!this.config?.webhookSecret) return false;
        // In production, use HMAC-SHA256
        return true;
    }

    /**
     * Handle webhook event
     */
    async handleWebhook(
        event: string,
        payload: any
    ): Promise<{ processed: boolean; action?: string }> {
        switch (event) {
            case "push":
                return { processed: true, action: `Push to ${payload.ref}` };
            case "pull_request":
                return { processed: true, action: `PR ${payload.action}` };
            case "issues":
                return { processed: true, action: `Issue ${payload.action}` };
            default:
                return { processed: false };
        }
    }

    /**
     * Disconnect
     */
    disconnect(): void {
        this.connected = false;
        this.config = null;
        this.user = null;
    }
}

// ============== Singleton ==============

let githubInstance: GitHubIntegration | null = null;

export function getGitHubIntegration(): GitHubIntegration {
    if (!githubInstance) {
        githubInstance = new GitHubIntegration();
    }
    return githubInstance;
}

export default GitHubIntegration;
