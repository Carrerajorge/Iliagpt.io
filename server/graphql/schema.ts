/**
 * GraphQL SDL Schema — IliaGPT Gateway
 * Covers: Users, Chats, Messages, Agents, Models, Documents, Analytics
 */

export const typeDefs = /* GraphQL */ `
  # ─── Scalars ────────────────────────────────────────────────────────────────
  scalar JSON
  scalar DateTime

  # ─── Directives ─────────────────────────────────────────────────────────────
  directive @auth(requires: Role = USER) on FIELD_DEFINITION | OBJECT
  directive @rateLimit(max: Int!, window: String!) on FIELD_DEFINITION
  directive @deprecated(reason: String) on FIELD_DEFINITION | ENUM_VALUE

  # ─── Enums ──────────────────────────────────────────────────────────────────
  enum Role {
    GUEST
    USER
    EDITOR
    ADMIN
  }

  enum ChatStatus {
    ACTIVE
    ARCHIVED
    DELETED
  }

  enum MessageRole {
    USER
    ASSISTANT
    SYSTEM
    TOOL
  }

  enum MessageStatus {
    PENDING
    PROCESSING
    DONE
    FAILED
  }

  enum AgentStatus {
    IDLE
    RUNNING
    PAUSED
    FAILED
    COMPLETED
  }

  enum TaskStatus {
    QUEUED
    RUNNING
    COMPLETED
    FAILED
    CANCELLED
  }

  enum ModelProvider {
    OPENAI
    ANTHROPIC
    GOOGLE
    MISTRAL
    GROQ
    LOCAL
  }

  enum DocumentStatus {
    PENDING
    PROCESSING
    READY
    FAILED
  }

  enum Period {
    HOUR
    DAY
    WEEK
    MONTH
    QUARTER
    YEAR
  }

  enum SortOrder {
    ASC
    DESC
  }

  # ─── Pagination ──────────────────────────────────────────────────────────────
  type PageInfo {
    hasNextPage: Boolean!
    hasPreviousPage: Boolean!
    startCursor: String
    endCursor: String
    totalCount: Int!
  }

  # ─── User Types ─────────────────────────────────────────────────────────────
  type User {
    id: ID!
    username: String
    email: String
    firstName: String
    lastName: String
    fullName: String
    profileImageUrl: String
    role: Role!
    plan: String!
    status: String!
    queryCount: Int!
    tokensConsumed: Int!
    tokensLimit: Int!
    creditsBalance: Int!
    dailyRequestsUsed: Int!
    dailyRequestsLimit: Int!
    is2faEnabled: Boolean!
    emailVerified: Boolean!
    authProvider: String!
    createdAt: DateTime!
    updatedAt: DateTime!
    settings: UserSettings
    chats(limit: Int, offset: Int): ChatConnection!
    usage(period: Period): UsageStats
  }

  type UserSettings {
    id: ID!
    userId: ID!
    responseStyle: String
    responseTone: String
    customInstructions: String
    memoryEnabled: Boolean!
    webSearchAuto: Boolean!
    codeInterpreterEnabled: Boolean!
    canvasEnabled: Boolean!
    voiceEnabled: Boolean!
    theme: String
    language: String
    updatedAt: DateTime!
  }

  type UserConnection {
    edges: [UserEdge!]!
    pageInfo: PageInfo!
  }

  type UserEdge {
    node: User!
    cursor: String!
  }

  # ─── Chat Types ─────────────────────────────────────────────────────────────
  type Chat {
    id: ID!
    userId: ID!
    title: String!
    gptId: String
    status: ChatStatus!
    archived: Boolean!
    pinned: Boolean!
    pinnedAt: DateTime
    messageCount: Int!
    tokensUsed: Int!
    aiModelUsed: String
    lastMessageAt: DateTime
    createdAt: DateTime!
    updatedAt: DateTime!
    messages(limit: Int, cursor: String): MessageConnection!
    user: User
  }

  type ChatConnection {
    edges: [ChatEdge!]!
    pageInfo: PageInfo!
  }

  type ChatEdge {
    node: Chat!
    cursor: String!
  }

  type Message {
    id: ID!
    chatId: ID!
    role: MessageRole!
    content: String!
    status: MessageStatus!
    attachments: JSON
    sources: JSON
    metadata: JSON
    createdAt: DateTime!
    chat: Chat
  }

  type MessageConnection {
    edges: [MessageEdge!]!
    pageInfo: PageInfo!
  }

  type MessageEdge {
    node: Message!
    cursor: String!
  }

  type SearchResult {
    message: Message!
    chatTitle: String!
    score: Float!
    highlight: String
  }

  # ─── Agent Types ─────────────────────────────────────────────────────────────
  type Agent {
    id: ID!
    name: String!
    description: String
    type: String!
    status: AgentStatus!
    capabilities: [String!]!
    config: JSON
    lastActiveAt: DateTime
    createdAt: DateTime!
    updatedAt: DateTime!
    tasks(limit: Int, offset: Int): TaskConnection!
    health: AgentHealth!
  }

  type AgentHealth {
    agentId: ID!
    status: AgentStatus!
    uptime: Float!
    tasksCompleted: Int!
    tasksFailed: Int!
    averageLatencyMs: Float!
    lastError: String
    checkedAt: DateTime!
  }

  type AgentTask {
    id: ID!
    agentId: ID!
    type: String!
    status: TaskStatus!
    input: JSON
    output: JSON
    error: String
    progress: Float
    startedAt: DateTime
    completedAt: DateTime
    createdAt: DateTime!
    agent: Agent
  }

  type TaskConnection {
    edges: [TaskEdge!]!
    pageInfo: PageInfo!
  }

  type TaskEdge {
    node: AgentTask!
    cursor: String!
  }

  type TaskProgressEvent {
    taskId: ID!
    agentId: ID!
    progress: Float!
    status: TaskStatus!
    message: String
    timestamp: DateTime!
  }

  type AgentLogEvent {
    agentId: ID!
    level: String!
    message: String!
    data: JSON
    timestamp: DateTime!
  }

  # ─── Model Types ─────────────────────────────────────────────────────────────
  type Model {
    id: ID!
    name: String!
    displayName: String!
    provider: ModelProvider!
    contextWindow: Int!
    maxOutputTokens: Int
    supportsVision: Boolean!
    supportsTools: Boolean!
    supportsStreaming: Boolean!
    costPer1kInputTokens: Float
    costPer1kOutputTokens: Float
    enabled: Boolean!
    isDefault: Boolean!
    config: JSON
    createdAt: DateTime!
    updatedAt: DateTime!
    health: ModelHealth
    usage(period: Period): ModelUsage
  }

  type ModelHealth {
    modelId: ID!
    available: Boolean!
    latencyMs: Float
    errorRate: Float!
    requestsLastHour: Int!
    checkedAt: DateTime!
  }

  type ModelUsage {
    modelId: ID!
    period: Period!
    totalRequests: Int!
    totalInputTokens: Int!
    totalOutputTokens: Int!
    totalCost: Float!
    averageLatencyMs: Float!
    errorCount: Int!
    from: DateTime!
    to: DateTime!
  }

  type ProviderStatus {
    provider: ModelProvider!
    available: Boolean!
    models: [Model!]!
    rateLimitRemaining: Int
    rateLimitReset: DateTime
    checkedAt: DateTime!
  }

  # ─── Document Types ──────────────────────────────────────────────────────────
  type Document {
    id: ID!
    userId: ID!
    name: String!
    mimeType: String!
    size: Int!
    status: DocumentStatus!
    path: String
    extractedText: String
    chunkCount: Int!
    embeddingCount: Int!
    metadata: JSON
    tags: [String!]!
    createdAt: DateTime!
    updatedAt: DateTime!
    user: User
    analysisResult: DocumentAnalysis
  }

  type DocumentAnalysis {
    documentId: ID!
    summary: String
    keyTopics: [String!]!
    language: String
    wordCount: Int
    sentiment: String
    entities: JSON
    analyzedAt: DateTime!
  }

  type DocumentConnection {
    edges: [DocumentEdge!]!
    pageInfo: PageInfo!
  }

  type DocumentEdge {
    node: Document!
    cursor: String!
  }

  type DocumentSearchResult {
    document: Document!
    score: Float!
    matchedChunks: [String!]!
  }

  # ─── Analytics Types ─────────────────────────────────────────────────────────
  type DashboardMetrics {
    period: Period!
    totalUsers: Int!
    activeUsers: Int!
    newUsers: Int!
    totalChats: Int!
    totalMessages: Int!
    totalTokensConsumed: Int!
    totalCost: Float!
    averageSessionDuration: Float!
    topModels: [ModelUsageSummary!]!
    userGrowth: [TimeSeriesPoint!]!
    messageVolume: [TimeSeriesPoint!]!
    costByDay: [TimeSeriesPoint!]!
    from: DateTime!
    to: DateTime!
  }

  type UsageStats {
    userId: ID
    period: Period!
    totalChats: Int!
    totalMessages: Int!
    totalTokensConsumed: Int!
    totalInputTokens: Int!
    totalOutputTokens: Int!
    estimatedCost: Float!
    modelsUsed: [String!]!
    averageMessagesPerChat: Float!
    from: DateTime!
    to: DateTime!
  }

  type CostBreakdown {
    period: Period!
    totalCost: Float!
    byProvider: [ProviderCost!]!
    byModel: [ModelCost!]!
    byUser: [UserCost!]!
    from: DateTime!
    to: DateTime!
  }

  type ProviderCost {
    provider: ModelProvider!
    cost: Float!
    percentage: Float!
    tokens: Int!
  }

  type ModelCost {
    modelId: ID!
    modelName: String!
    cost: Float!
    percentage: Float!
    requests: Int!
  }

  type UserCost {
    userId: ID!
    username: String
    cost: Float!
    tokens: Int!
  }

  type ModelPerformance {
    period: Period!
    models: [ModelPerfEntry!]!
    from: DateTime!
    to: DateTime!
  }

  type ModelPerfEntry {
    modelId: ID!
    modelName: String!
    provider: ModelProvider!
    totalRequests: Int!
    successRate: Float!
    averageLatencyMs: Float!
    p95LatencyMs: Float!
    tokensPerSecond: Float!
    costEfficiency: Float!
  }

  type ModelUsageSummary {
    modelId: ID!
    modelName: String!
    requests: Int!
    percentage: Float!
  }

  type TimeSeriesPoint {
    timestamp: DateTime!
    value: Float!
    label: String
  }

  # ─── Input Types ─────────────────────────────────────────────────────────────
  input CreateChatInput {
    title: String
    gptId: String
    initialMessage: String
  }

  input SendMessageInput {
    chatId: ID!
    content: String!
    role: MessageRole
    attachments: JSON
    modelId: String
  }

  input UpdateSettingsInput {
    responseStyle: String
    responseTone: String
    customInstructions: String
    memoryEnabled: Boolean
    webSearchAuto: Boolean
    codeInterpreterEnabled: Boolean
    canvasEnabled: Boolean
    voiceEnabled: Boolean
    theme: String
    language: String
  }

  input UpdateProfileInput {
    firstName: String
    lastName: String
    username: String
    profileImageUrl: String
    company: String
    phone: String
  }

  input CreateAgentInput {
    name: String!
    description: String
    type: String!
    capabilities: [String!]!
    config: JSON
  }

  input ExecuteTaskInput {
    agentId: ID!
    type: String!
    input: JSON
    priority: Int
    timeoutMs: Int
  }

  input ConfigureAgentInput {
    name: String
    description: String
    config: JSON
    capabilities: [String!]
  }

  input ConfigureProviderInput {
    provider: ModelProvider!
    apiKey: String
    baseUrl: String
    config: JSON
    enabled: Boolean
  }

  input CreateDocumentInput {
    name: String!
    mimeType: String!
    content: String
    tags: [String!]
    metadata: JSON
  }

  input UpdateDocumentInput {
    name: String
    tags: [String!]
    metadata: JSON
  }

  input DocumentFilterInput {
    status: DocumentStatus
    mimeType: String
    tags: [String!]
    search: String
    from: DateTime
    to: DateTime
  }

  input ChatFilterInput {
    status: ChatStatus
    search: String
    gptId: String
    from: DateTime
    to: DateTime
  }

  # ─── Root Types ──────────────────────────────────────────────────────────────
  type Query {
    # Chat queries
    chats(filter: ChatFilterInput, limit: Int, offset: Int): ChatConnection! @auth
    chat(id: ID!): Chat @auth
    messages(chatId: ID!, limit: Int, cursor: String): MessageConnection! @auth
    searchMessages(query: String!, limit: Int): [SearchResult!]! @auth

    # Agent queries
    agents: [Agent!]! @auth
    agent(id: ID!): Agent @auth
    agentTasks(agentId: ID!, limit: Int, offset: Int): TaskConnection! @auth
    agentHealth: [AgentHealth!]! @auth

    # Model queries
    models: [Model!]! @auth
    modelHealth(modelId: ID!): ModelHealth @auth
    modelUsage(modelId: ID!, period: Period): ModelUsage @auth
    providerStatus: [ProviderStatus!]! @auth

    # User queries
    me: User @auth
    users(limit: Int, offset: Int): UserConnection! @auth(requires: ADMIN)
    userSettings(userId: ID!): UserSettings @auth
    usage(userId: ID, period: Period): UsageStats @auth

    # Document queries
    documents(filter: DocumentFilterInput, limit: Int, offset: Int): DocumentConnection! @auth
    document(id: ID!): Document @auth
    searchDocuments(query: String!, limit: Int): [DocumentSearchResult!]! @auth

    # Analytics queries
    dashboardMetrics(period: Period): DashboardMetrics! @auth(requires: ADMIN)
    usageStats(userId: ID, period: Period): UsageStats! @auth
    costBreakdown(period: Period): CostBreakdown! @auth(requires: ADMIN)
    modelPerformance(period: Period): ModelPerformance! @auth(requires: ADMIN)
  }

  type Mutation {
    # Chat mutations
    createChat(input: CreateChatInput!): Chat! @auth
    sendMessage(input: SendMessageInput!): Message! @auth @rateLimit(max: 60, window: "1m")
    deleteChat(id: ID!): Boolean! @auth
    archiveChat(id: ID!): Chat! @auth

    # Agent mutations
    createAgent(input: CreateAgentInput!): Agent! @auth(requires: ADMIN)
    executeTask(input: ExecuteTaskInput!): AgentTask! @auth
    cancelTask(id: ID!): AgentTask! @auth
    configureAgent(id: ID!, input: ConfigureAgentInput!): Agent! @auth(requires: ADMIN)

    # Model mutations
    setDefaultModel(modelId: ID!): Model! @auth(requires: ADMIN)
    configureProvider(input: ConfigureProviderInput!): ProviderStatus! @auth(requires: ADMIN)
    enableModel(modelId: ID!, enabled: Boolean!): Model! @auth(requires: ADMIN)

    # User mutations
    updateSettings(input: UpdateSettingsInput!): UserSettings! @auth
    updateProfile(input: UpdateProfileInput!): User! @auth

    # Document mutations
    createDocument(input: CreateDocumentInput!): Document! @auth
    updateDocument(id: ID!, input: UpdateDocumentInput!): Document! @auth
    analyzeDocument(id: ID!): DocumentAnalysis! @auth
    deleteDocument(id: ID!): Boolean! @auth
  }

  type Subscription {
    # Chat subscriptions
    messageAdded(chatId: ID!): Message! @auth
    chatUpdated(userId: ID!): Chat! @auth
    agentStatusChanged(agentId: ID!): AgentHealth! @auth

    # Agent subscriptions
    taskProgress(taskId: ID!): TaskProgressEvent! @auth
    agentLog(agentId: ID!): AgentLogEvent! @auth
  }
`;
