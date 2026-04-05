import { gql } from 'graphql-tag';
import type { DocumentNode } from 'graphql';

// ─── Enums ───────────────────────────────────────────────────────────────────

// ─── Full Schema Definition ───────────────────────────────────────────────────

export const typeDefs: DocumentNode = gql`
  # ─── Scalars ─────────────────────────────────────────────────────────────────
  scalar DateTime
  scalar JSON
  scalar Upload

  # ─── Enums ───────────────────────────────────────────────────────────────────

  enum UserRole {
    ADMIN
    USER
    GUEST
    MODERATOR
  }

  enum MessageRole {
    USER
    ASSISTANT
    SYSTEM
    TOOL
  }

  enum ModelProvider {
    OPENAI
    ANTHROPIC
    GOOGLE
    MISTRAL
    COHERE
    LLAMA
    CUSTOM
  }

  enum ModelCapability {
    CHAT
    COMPLETION
    EMBEDDING
    IMAGE_GENERATION
    IMAGE_ANALYSIS
    AUDIO_TRANSCRIPTION
    FUNCTION_CALLING
    CODE_GENERATION
    REASONING
  }

  enum AgentStatus {
    DRAFT
    ACTIVE
    ARCHIVED
    PUBLISHED
  }

  enum ChatStatus {
    ACTIVE
    ARCHIVED
    DELETED
    SHARED
  }

  enum ExecutionStatus {
    PENDING
    RUNNING
    COMPLETED
    FAILED
    CANCELLED
  }

  enum DocumentStatus {
    UPLOADING
    PROCESSING
    READY
    ERROR
  }

  enum SortOrder {
    ASC
    DESC
  }

  # ─── Pagination ───────────────────────────────────────────────────────────────

  type PageInfo {
    hasNextPage: Boolean!
    hasPreviousPage: Boolean!
    startCursor: String
    endCursor: String
    totalCount: Int!
  }

  type UserEdge {
    node: User!
    cursor: String!
  }

  type UserConnection {
    edges: [UserEdge!]!
    pageInfo: PageInfo!
  }

  type ChatEdge {
    node: Chat!
    cursor: String!
  }

  type ChatConnection {
    edges: [ChatEdge!]!
    pageInfo: PageInfo!
  }

  type MessageEdge {
    node: Message!
    cursor: String!
  }

  type MessageConnection {
    edges: [MessageEdge!]!
    pageInfo: PageInfo!
  }

  type AgentEdge {
    node: Agent!
    cursor: String!
  }

  type AgentConnection {
    edges: [AgentEdge!]!
    pageInfo: PageInfo!
  }

  type DocumentEdge {
    node: Document!
    cursor: String!
  }

  type DocumentConnection {
    edges: [DocumentEdge!]!
    pageInfo: PageInfo!
  }

  # ─── Core Types ───────────────────────────────────────────────────────────────

  type UserPreferences {
    theme: String
    language: String
    timezone: String
    notifications: Boolean
    defaultModel: String
    autoSave: Boolean
    streamingEnabled: Boolean
    codeHighlighting: Boolean
    markdownRendering: Boolean
    customInstructions: String
  }

  type UserUsage {
    totalTokens: Int!
    totalChats: Int!
    totalMessages: Int!
    totalDocuments: Int!
    lastActiveAt: DateTime
    monthlyTokens: Int!
  }

  type User {
    id: ID!
    email: String!
    role: UserRole!
    createdAt: DateTime!
    updatedAt: DateTime!
    preferences: UserPreferences
    tenantId: String
    displayName: String
    avatarUrl: String
    isEmailVerified: Boolean!
    isActive: Boolean!
    # Field resolvers
    chats(first: Int, after: String): ChatConnection!
    agents(first: Int, after: String): AgentConnection!
    documents(first: Int, after: String): DocumentConnection!
    usage: UserUsage!
  }

  type TokenUsage {
    promptTokens: Int!
    completionTokens: Int!
    totalTokens: Int!
    cost: Float
  }

  type MessageMetadata {
    model: String
    temperature: Float
    stopReason: String
    latencyMs: Int
    toolCalls: JSON
    citations: JSON
    isEdited: Boolean
    editedAt: DateTime
  }

  type Message {
    id: ID!
    chatId: ID!
    role: MessageRole!
    content: String!
    tokens: TokenUsage
    timestamp: DateTime!
    metadata: MessageMetadata
    parentId: ID
    isStreaming: Boolean!
  }

  type ChatMetadata {
    isPublic: Boolean
    shareToken: String
    archivedAt: DateTime
    tags: [String!]
    summary: String
    lastModel: String
    totalTokens: Int
    pinned: Boolean
  }

  type Chat {
    id: ID!
    title: String!
    userId: ID!
    model: String!
    status: ChatStatus!
    createdAt: DateTime!
    updatedAt: DateTime!
    metadata: ChatMetadata
    # Field resolvers
    messages(first: Int, after: String, last: Int, before: String): MessageConnection!
    user: User
    messageCount: Int!
  }

  type AgentTool {
    name: String!
    description: String
    schema: JSON
    enabled: Boolean!
  }

  type Agent {
    id: ID!
    name: String!
    description: String
    instructions: String!
    model: String!
    tools: [AgentTool!]!
    userId: ID!
    status: AgentStatus!
    isPublic: Boolean!
    createdAt: DateTime!
    updatedAt: DateTime!
    metadata: JSON
    # Field resolvers
    user: User
    executionCount: Int!
  }

  type ModelPricing {
    inputPer1kTokens: Float!
    outputPer1kTokens: Float!
    currency: String!
  }

  type Model {
    id: ID!
    provider: ModelProvider!
    name: String!
    displayName: String!
    contextWindow: Int!
    capabilities: [ModelCapability!]!
    pricing: ModelPricing!
    enabled: Boolean!
    isDefault: Boolean!
    maxOutputTokens: Int
    supportsStreaming: Boolean!
    supportsVision: Boolean!
    supportsFunctionCalling: Boolean!
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  type ModelUsageStat {
    modelId: ID!
    totalRequests: Int!
    totalTokens: Int!
    totalCost: Float!
    avgLatencyMs: Float!
    errorRate: Float!
    period: String!
  }

  type Document {
    id: ID!
    name: String!
    mimeType: String!
    size: Int!
    url: String!
    userId: ID!
    status: DocumentStatus!
    uploadedAt: DateTime!
    processedAt: DateTime
    metadata: JSON
    # Field resolvers
    user: User
  }

  type AgentExecution {
    id: ID!
    agentId: ID!
    chatId: ID
    status: ExecutionStatus!
    input: String!
    output: String
    startedAt: DateTime!
    completedAt: DateTime
    tokensUsed: Int
    error: String
  }

  # ─── Streaming / Subscription Types ──────────────────────────────────────────

  type MessageStreamChunk {
    chatId: ID!
    messageId: ID!
    delta: String!
    isComplete: Boolean!
    tokensUsed: Int
    metadata: JSON
  }

  type ChatEvent {
    type: String!
    chatId: ID!
    userId: ID!
    payload: JSON!
    timestamp: DateTime!
  }

  # ─── Input Types ──────────────────────────────────────────────────────────────

  input PaginationInput {
    first: Int
    after: String
    last: Int
    before: String
  }

  input CreateChatInput {
    title: String!
    model: String!
    systemPrompt: String
    metadata: JSON
  }

  input UpdateChatInput {
    title: String
    model: String
    metadata: JSON
  }

  input AddMessageInput {
    chatId: ID!
    role: MessageRole!
    content: String!
    parentId: ID
    metadata: JSON
  }

  input EditMessageInput {
    messageId: ID!
    content: String!
  }

  input CreateAgentInput {
    name: String!
    description: String
    instructions: String!
    model: String!
    tools: [AgentToolInput!]
    isPublic: Boolean
    metadata: JSON
  }

  input UpdateAgentInput {
    name: String
    description: String
    instructions: String
    model: String
    tools: [AgentToolInput!]
    isPublic: Boolean
    metadata: JSON
  }

  input AgentToolInput {
    name: String!
    description: String
    schema: JSON
    enabled: Boolean!
  }

  input ExecuteAgentInput {
    agentId: ID!
    input: String!
    chatId: ID
    stream: Boolean
  }

  input UpdateProfileInput {
    displayName: String
    avatarUrl: String
    email: String
  }

  input UpdatePreferencesInput {
    theme: String
    language: String
    timezone: String
    notifications: Boolean
    defaultModel: String
    autoSave: Boolean
    streamingEnabled: Boolean
    codeHighlighting: Boolean
    markdownRendering: Boolean
    customInstructions: String
  }

  input ChangePasswordInput {
    currentPassword: String!
    newPassword: String!
  }

  input UpdateModelConfigInput {
    displayName: String
    enabled: Boolean
    isDefault: Boolean
    pricing: ModelPricingInput
    maxOutputTokens: Int
    capabilities: [ModelCapability!]
  }

  input ModelPricingInput {
    inputPer1kTokens: Float!
    outputPer1kTokens: Float!
    currency: String!
  }

  input ModelFilterInput {
    provider: ModelProvider
    capability: ModelCapability
    enabled: Boolean
    supportsVision: Boolean
    supportsFunctionCalling: Boolean
  }

  input UserFilterInput {
    role: UserRole
    isActive: Boolean
    search: String
    tenantId: String
  }

  input TimeRangeInput {
    from: DateTime!
    to: DateTime!
  }

  # ─── Queries ──────────────────────────────────────────────────────────────────

  type Query {
    # Chat queries
    chats(pagination: PaginationInput, userId: ID): ChatConnection!
    chat(id: ID!): Chat
    searchChats(query: String!, userId: ID, pagination: PaginationInput): ChatConnection!

    # Message queries
    messages(chatId: ID!, pagination: PaginationInput): MessageConnection!

    # Agent queries
    agents(userId: ID, pagination: PaginationInput): AgentConnection!
    agent(id: ID!): Agent
    publicAgents(pagination: PaginationInput): AgentConnection!

    # Model queries
    models(filter: ModelFilterInput): [Model!]!
    model(id: ID!): Model
    availableModels(userId: ID): [Model!]!
    modelPricing: [Model!]!
    modelUsageStats(modelId: ID!, timeRange: TimeRangeInput!): ModelUsageStat

    # User queries
    me: User
    user(id: ID!): User
    users(pagination: PaginationInput, filter: UserFilterInput): UserConnection!

    # Document queries
    documents(userId: ID, pagination: PaginationInput): DocumentConnection!
    document(id: ID!): Document
  }

  # ─── Mutations ────────────────────────────────────────────────────────────────

  type Mutation {
    # Chat mutations
    createChat(input: CreateChatInput!): Chat!
    updateChat(id: ID!, input: UpdateChatInput!): Chat!
    deleteChat(id: ID!): Boolean!
    archiveChat(id: ID!): Chat!
    shareChat(id: ID!): Chat!
    addMessage(input: AddMessageInput!): Message!
    deleteMessage(id: ID!): Boolean!
    editMessage(input: EditMessageInput!): Message!

    # Agent mutations
    createAgent(input: CreateAgentInput!): Agent!
    updateAgent(id: ID!, input: UpdateAgentInput!): Agent!
    deleteAgent(id: ID!): Boolean!
    cloneAgent(id: ID!, name: String): Agent!
    publishAgent(id: ID!): Agent!
    executeAgent(input: ExecuteAgentInput!): AgentExecution!

    # Model mutations (admin only)
    enableModel(id: ID!): Model!
    disableModel(id: ID!): Model!
    updateModelConfig(id: ID!, input: UpdateModelConfigInput!): Model!
    setDefaultModel(id: ID!): Model!

    # User mutations
    updateProfile(input: UpdateProfileInput!): User!
    updatePreferences(input: UpdatePreferencesInput!): User!
    deleteAccount(confirm: Boolean!): Boolean!
    changePassword(input: ChangePasswordInput!): Boolean!
    requestEmailVerification: Boolean!
  }

  # ─── Subscriptions ────────────────────────────────────────────────────────────

  type Subscription {
    onMessageStream(chatId: ID!): MessageStreamChunk!
    onChatUpdated(userId: ID!): ChatEvent!
    onAgentExecution(executionId: ID!): AgentExecution!
  }
`;

export default typeDefs;
