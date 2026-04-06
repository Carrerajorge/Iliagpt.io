/**
 * @deprecated This monolithic storage layer is being refactored into modular repositories.
 * 
 * NEW MODULAR APPROACH:
 * - User operations: import { userRepository } from './repositories/userRepository'
 * - Chat operations: import { chatRepository } from './repositories/chatRepository'
 * - Base utilities:  import { validateOwnership, validateUserId } from './repositories/baseRepository'
 * 
 * The new repositories provide:
 * - Better multi-tenant security with userId validation
 * - Ownership checks for resource access
 * - Structured logging
 * - Transaction helpers
 * 
 * This file is kept for backward compatibility. Gradually migrate to the new repositories.
 * See: server/repositories/index.ts for all available exports.
 */

import { cache } from "./lib/cache";
import {
  type User, type InsertUser,
  type File, type InsertFile,
  type FileChunk, type InsertFileChunk,
  type FileJob, type InsertFileJob,
  type AgentRun, type InsertAgentRun,
  type AgentStep, type InsertAgentStep,
  type AgentAsset, type InsertAgentAsset,
  type DomainPolicy, type InsertDomainPolicy,
  type Chat, type InsertChat,
  type ChatMessage, type InsertChatMessage,
  type ChatShare, type InsertChatShare,
  type ChatRun, type InsertChatRun,
  type ToolInvocation, type InsertToolInvocation,
  type Gpt, type InsertGpt,
  type GptCategory, type InsertGptCategory,
  type GptVersion, type InsertGptVersion,
  type GptKnowledge, type InsertGptKnowledge,
  type GptAction, type InsertGptAction,
  type AiModel, type InsertAiModel,
  type Payment, type InsertPayment,
  type Invoice, type InsertInvoice,
  type PlatformSetting, type InsertPlatformSetting,
  type AuditLog, type InsertAuditLog,
  type AnalyticsSnapshot, type InsertAnalyticsSnapshot,
  type Report, type InsertReport,
  type LibraryItem, type InsertLibraryItem,
  type NotificationEventType, type NotificationPreference, type InsertNotificationPreference,
  type UserSettings, type InsertUserSettings,
  type IntegrationProvider, type InsertIntegrationProvider,
  type IntegrationAccount, type InsertIntegrationAccount,
  type IntegrationTool, type InsertIntegrationTool,
  type IntegrationPolicy, type InsertIntegrationPolicy,
  type ToolCallLog, type InsertToolCallLog,
  type ConsentLog, type SharedLink, type InsertSharedLink,
  type CompanyKnowledge, type InsertCompanyKnowledge,
  type GmailOAuthToken, type InsertGmailOAuthToken,
  type ResponseQualityMetric, type InsertResponseQualityMetric,
  type ConnectorUsageHourly, type InsertConnectorUsageHourly,
  type OfflineMessageQueue, type InsertOfflineMessageQueue,
  type ProviderMetrics, type InsertProviderMetrics,
  type CostBudget, type InsertCostBudget,
  type ApiLog, type InsertApiLog,
  type KpiSnapshot, type InsertKpiSnapshot,
  type AnalyticsEvent, type InsertAnalyticsEvent,
  type SecurityPolicy, type InsertSecurityPolicy,
  type ReportTemplate, type InsertReportTemplate,
  type GeneratedReport, type InsertGeneratedReport,
  type SettingsConfig, type InsertSettingsConfig,
  type AgentGapLog, type InsertAgentGapLog,
  type LibraryFolder, type InsertLibraryFolder,
  type LibraryFile, type InsertLibraryFile,
  type LibraryCollection, type InsertLibraryCollection,
  type LibraryStorageStats,
  type LibraryActivityRecord,
  type ChatMessageAnalysis, type InsertChatMessageAnalysis,
  chatMessageAnalysis,
  files, fileChunks, fileJobs, agentRuns, agentSteps, agentAssets, domainPolicies, chats, chatMessages, chatShares,
  chatRuns, toolInvocations, conversationDocuments,
  type ConversationDocument, type InsertConversationDocument,
  gpts, gptCategories, gptVersions, gptKnowledge, gptActions, sidebarPinnedGpts, users,
  aiModels, payments, invoices, platformSettings, auditLogs, analyticsSnapshots, reports, libraryItems,
  notificationEventTypes, notificationPreferences, userSettings,
  integrationProviders, integrationAccounts, integrationTools, integrationPolicies, toolCallLogs,
  consentLogs, sharedLinks, companyKnowledge, gmailOAuthTokens,
  responseQualityMetrics, connectorUsageHourly, offlineMessageQueue,
  providerMetrics, costBudgets, apiLogs, kpiSnapshots, analyticsEvents, securityPolicies,
  reportTemplates, generatedReports, settingsConfig, agentGapLogs,
  libraryFolders, libraryFiles, libraryCollections, libraryFileCollections, libraryActivity, libraryStorage
} from "../shared/schema";
import * as crypto from "crypto";
import { randomUUID } from "crypto";
import { db, dbRead } from "./db";
import { eq, sql, desc, and, isNull, ilike, inArray, or, type SQL } from "drizzle-orm";
import { knowledgeBaseService } from "./services/knowledgeBase";
import { normalizeStoredMoneyFields } from "./lib/money";

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  createFile(file: InsertFile): Promise<File>;
  getFile(id: string): Promise<File | undefined>;
  getFileByStoragePath(storagePath: string): Promise<File | undefined>;
  getFiles(userId?: string): Promise<File[]>;
  updateFileStatus(id: string, status: string): Promise<File | undefined>;
  deleteFile(id: string): Promise<void>;
  updateFileProgress(id: string, progress: number): Promise<File | undefined>;
  updateFileError(id: string, error: string): Promise<File | undefined>;
  updateFileCompleted(id: string): Promise<File | undefined>;
  updateFileUploadChunks(id: string, uploadedChunks: number, totalChunks: number): Promise<File | undefined>;
  createFileJob(job: InsertFileJob): Promise<FileJob>;
  getFileJob(fileId: string): Promise<FileJob | undefined>;
  updateFileJobStatus(fileId: string, status: string, error?: string): Promise<FileJob | undefined>;
  createFileChunks(chunks: InsertFileChunk[]): Promise<FileChunk[]>;
  getFileChunks(fileId: string): Promise<FileChunk[]>;
  searchSimilarChunks(embedding: number[], limit?: number, userId?: string): Promise<FileChunk[]>;
  updateFileChunkEmbedding(fileId: string, chunkIndex: number, embedding: number[]): Promise<void>;
  // Agent CRUD operations
  createAgentRun(run: InsertAgentRun): Promise<AgentRun>;
  getAgentRun(id: string): Promise<AgentRun | undefined>;
  getAgentRunsByChatId(chatId: string): Promise<AgentRun[]>;
  updateAgentRunStatus(id: string, status: string, error?: string): Promise<AgentRun | undefined>;
  createAgentStep(step: InsertAgentStep): Promise<AgentStep>;
  getAgentSteps(runId: string): Promise<AgentStep[]>;
  updateAgentStepStatus(id: string, success: string, error?: string): Promise<AgentStep | undefined>;
  createAgentAsset(asset: InsertAgentAsset): Promise<AgentAsset>;
  getAgentAssets(runId: string): Promise<AgentAsset[]>;
  getDomainPolicy(domain: string): Promise<DomainPolicy | undefined>;
  createDomainPolicy(policy: InsertDomainPolicy): Promise<DomainPolicy>;
  // Chat CRUD operations
  createChat(chat: InsertChat): Promise<Chat>;
  getChat(id: string): Promise<Chat | undefined>;
  getChats(userId?: string): Promise<Chat[]>;
  getActiveChats(userId: string): Promise<Chat[]>;
  updateChat(id: string, updates: Partial<InsertChat>): Promise<Chat | undefined>;
  deleteChat(id: string): Promise<void>;
  createChatMessage(message: InsertChatMessage): Promise<ChatMessage>;
  getChatMessage(chatId: string, messageId: string): Promise<ChatMessage | undefined>;
  getChatMessages(chatId: string, options?: { limit?: number; offset?: number; before?: Date; orderBy?: 'asc' | 'desc' }): Promise<ChatMessage[]>;
  updateChatMessageContent(id: string, content: string, status: string, metadata?: Record<string, any>): Promise<ChatMessage | undefined>;
  createChatWithMessages(chat: InsertChat, messages: Partial<InsertChatMessage>[]): Promise<{ chat: Chat; messages: ChatMessage[] }>;
  searchMessages(userId: string, query: string): Promise<ChatMessage[]>;
  // Chat Run operations (for idempotent message processing)
  createChatRun(run: InsertChatRun): Promise<ChatRun>;
  getChatRun(id: string): Promise<ChatRun | undefined>;
  getChatRunByClientRequestId(chatId: string, clientRequestId: string): Promise<ChatRun | undefined>;
  claimPendingRun(chatId: string, clientRequestId?: string): Promise<ChatRun | undefined>;
  updateChatRunStatus(id: string, status: string, error?: string): Promise<ChatRun | undefined>;
  updateChatRunAssistantMessage(id: string, assistantMessageId: string): Promise<ChatRun | undefined>;
  updateChatRunLastSeq(id: string, lastSeq: number): Promise<ChatRun | undefined>;
  createUserMessageAndRun(chatId: string, message: InsertChatMessage, clientRequestId: string): Promise<{ message: ChatMessage; run: ChatRun }>;
  // Tool Invocation operations (for idempotent tool calls)
  createToolInvocation(invocation: InsertToolInvocation): Promise<ToolInvocation>;
  getToolInvocation(runId: string, toolCallId: string): Promise<ToolInvocation | undefined>;
  updateToolInvocationResult(id: string, output: any, status: string, error?: string): Promise<ToolInvocation | undefined>;
  // Chat Share operations
  createChatShare(share: InsertChatShare): Promise<ChatShare>;
  getChatShares(chatId: string): Promise<ChatShare[]>;
  getChatSharesByEmail(email: string): Promise<ChatShare[]>;
  getChatSharesByUserId(userId: string): Promise<ChatShare[]>;
  getSharedChatsWithDetails(userId: string): Promise<(Chat & { shareRole: string; shareId: string })[]>;
  getChatShareByEmailAndChat(email: string, chatId: string): Promise<ChatShare | undefined>;
  getChatShareByUserAndChat(userId: string, chatId: string): Promise<ChatShare | undefined>;
  updateChatShare(id: string, updates: Partial<InsertChatShare>): Promise<ChatShare | undefined>;
  deleteChatShare(id: string): Promise<void>;
  getUserByEmail(email: string): Promise<User | undefined>;
  // GPT CRUD operations
  createGpt(gpt: InsertGpt): Promise<Gpt>;
  getGpt(id: string): Promise<Gpt | undefined>;
  getGptBySlug(slug: string): Promise<Gpt | undefined>;
  getGpts(filters?: { visibility?: string; categoryId?: string; creatorId?: string }): Promise<Gpt[]>;
  getPopularGpts(limit?: number): Promise<Gpt[]>;
  updateGpt(id: string, updates: Partial<InsertGpt>): Promise<Gpt | undefined>;
  deleteGpt(id: string): Promise<void>;
  incrementGptUsage(id: string): Promise<void>;
  getGptConversationCount(gptId: string): Promise<number>;
  // GPT Category operations
  createGptCategory(category: InsertGptCategory): Promise<GptCategory>;
  getGptCategories(): Promise<GptCategory[]>;
  // GPT Version operations
  createGptVersion(version: InsertGptVersion): Promise<GptVersion>;
  getGptVersions(gptId: string): Promise<GptVersion[]>;
  getLatestGptVersion(gptId: string): Promise<GptVersion | undefined>;
  getGptVersionByNumber(gptId: string, versionNumber: number): Promise<GptVersion | undefined>;
  // GPT Knowledge operations
  createGptKnowledge(knowledge: InsertGptKnowledge): Promise<GptKnowledge>;
  getGptKnowledge(gptId: string): Promise<GptKnowledge[]>;
  getGptKnowledgeById(id: string): Promise<GptKnowledge | undefined>;
  updateGptKnowledge(id: string, updates: Partial<InsertGptKnowledge>): Promise<GptKnowledge | undefined>;
  deleteGptKnowledge(id: string): Promise<void>;
  // GPT Actions operations
  createGptAction(action: InsertGptAction): Promise<GptAction>;
  getGptActions(gptId: string): Promise<GptAction[]>;
  getGptActionById(id: string): Promise<GptAction | undefined>;
  getGptActionByIdAndGpt(actionId: string, gptId: string): Promise<GptAction | undefined>;
  updateGptAction(id: string, updates: Partial<InsertGptAction>): Promise<GptAction | undefined>;
  deleteGptAction(id: string): Promise<void>;
  incrementGptActionUsage(id: string): Promise<void>;
  // Sidebar Pinned GPTs
  getSidebarPinnedGpts(userId: string): Promise<any[]>;
  pinGptToSidebar(userId: string, gptId: string, displayOrder?: number): Promise<any>;
  unpinGptFromSidebar(userId: string, gptId: string): Promise<void>;
  isGptPinnedToSidebar(userId: string, gptId: string): Promise<boolean>;
  // Admin: User management
  getAllUsers(): Promise<User[]>;
  updateUser(id: string, updates: Partial<User>): Promise<User | undefined>;
  deleteUser(id: string): Promise<void>;
  getUserStats(): Promise<{ total: number; active: number; newThisMonth: number; newLastMonth: number }>;
  // Admin: AI Models
  createAiModel(model: InsertAiModel): Promise<AiModel>;
  getAiModels(): Promise<AiModel[]>;
  getAiModelsFiltered(filters: { provider?: string; providers?: string[]; type?: string; status?: string; search?: string; sortBy?: string; sortOrder?: string; page?: number; limit?: number }): Promise<{ models: AiModel[]; total: number }>;
  getAiModelById(id: string): Promise<AiModel | undefined>;
  getAiModelByModelId(modelId: string, provider: string): Promise<AiModel | undefined>;
  updateAiModel(id: string, updates: Partial<InsertAiModel>): Promise<AiModel | undefined>;
  deleteAiModel(id: string): Promise<void>;
  // Admin: Payments
  createPayment(payment: InsertPayment): Promise<Payment>;
  getPayments(): Promise<Payment[]>;
  updatePayment(id: string, updates: Partial<InsertPayment>): Promise<Payment | undefined>;
  getPaymentStats(): Promise<{ total: string; thisMonth: string; previousMonth: string; count: number }>;
  // Admin: Invoices
  createInvoice(invoice: InsertInvoice): Promise<Invoice>;
  getInvoices(): Promise<Invoice[]>;
  updateInvoice(id: string, updates: Partial<InsertInvoice>): Promise<Invoice | undefined>;
  // Admin: Settings
  getSetting(key: string): Promise<PlatformSetting | undefined>;
  getSettings(): Promise<PlatformSetting[]>;
  upsertSetting(key: string, value: string, description?: string, category?: string): Promise<PlatformSetting>;
  // Admin: Audit Logs
  createAuditLog(log: InsertAuditLog): Promise<AuditLog>;
  getAuditLogs(limit?: number): Promise<AuditLog[]>;
  // Admin: Analytics
  createAnalyticsSnapshot(snapshot: InsertAnalyticsSnapshot): Promise<AnalyticsSnapshot>;
  getAnalyticsSnapshots(days?: number): Promise<AnalyticsSnapshot[]>;
  getDashboardMetrics(): Promise<{ users: number; queries: number; revenue: string; uptime: number }>;
  // Admin: Reports
  createReport(report: InsertReport): Promise<Report>;
  getReports(): Promise<Report[]>;
  updateReport(id: string, updates: Partial<InsertReport>): Promise<Report | undefined>;
  // Admin: Domain Policies
  getDomainPolicies(): Promise<DomainPolicy[]>;
  updateDomainPolicy(id: string, updates: Partial<InsertDomainPolicy>): Promise<DomainPolicy | undefined>;
  deleteDomainPolicy(id: string): Promise<void>;
  // Library Items CRUD
  createLibraryItem(item: InsertLibraryItem): Promise<LibraryItem>;
  getLibraryItems(userId: string, mediaType?: string): Promise<LibraryItem[]>;
  getLibraryItem(id: string, userId: string): Promise<LibraryItem | null>;
  deleteLibraryItem(id: string, userId: string): Promise<boolean>;
  // Notification Preferences
  getNotificationEventTypes(): Promise<NotificationEventType[]>;
  getNotificationPreferences(userId: string): Promise<NotificationPreference[]>;
  upsertNotificationPreference(pref: InsertNotificationPreference): Promise<NotificationPreference>;
  // User Settings
  getUserSettings(userId: string): Promise<UserSettings | null>;
  upsertUserSettings(userId: string, settings: Partial<InsertUserSettings>): Promise<UserSettings>;
  // Integration Management
  getIntegrationProviders(): Promise<IntegrationProvider[]>;
  getIntegrationProvider(id: string): Promise<IntegrationProvider | null>;
  createIntegrationProvider(provider: InsertIntegrationProvider): Promise<IntegrationProvider>;
  getIntegrationAccounts(userId: string): Promise<IntegrationAccount[]>;
  getIntegrationAccount(id: string): Promise<IntegrationAccount | null>;
  getIntegrationAccountByProvider(userId: string, providerId: string): Promise<IntegrationAccount | null>;
  createIntegrationAccount(account: InsertIntegrationAccount): Promise<IntegrationAccount>;
  updateIntegrationAccount(id: string, updates: Partial<InsertIntegrationAccount>): Promise<IntegrationAccount | null>;
  deleteIntegrationAccount(id: string): Promise<void>;
  getIntegrationTools(providerId?: string): Promise<IntegrationTool[]>;
  getIntegrationPolicy(userId: string): Promise<IntegrationPolicy | null>;
  upsertIntegrationPolicy(userId: string, policy: Partial<InsertIntegrationPolicy>): Promise<IntegrationPolicy>;
  createToolCallLog(log: InsertToolCallLog): Promise<ToolCallLog>;
  getToolCallLogs(userId: string, limit?: number): Promise<ToolCallLog[]>;
  // Consent Logs
  logConsent(userId: string, consentType: string, value: string, ipAddress?: string, userAgent?: string): Promise<void>;
  getConsentLogs(userId: string, limit?: number): Promise<ConsentLog[]>;
  // Shared Links CRUD
  createSharedLink(data: InsertSharedLink): Promise<SharedLink>;
  getSharedLinks(userId: string): Promise<SharedLink[]>;
  getSharedLinkByToken(token: string): Promise<SharedLink | undefined>;
  updateSharedLink(id: string, data: Partial<InsertSharedLink>): Promise<SharedLink>;
  revokeSharedLink(id: string): Promise<void>;
  rotateSharedLinkToken(id: string): Promise<SharedLink>;
  incrementSharedLinkAccess(id: string): Promise<void>;
  // Archived/Deleted Chats
  getArchivedChats(userId: string): Promise<Chat[]>;
  unarchiveChat(chatId: string): Promise<void>;
  archiveAllChats(userId: string): Promise<number>;
  softDeleteChat(chatId: string): Promise<void>;
  softDeleteAllChats(userId: string): Promise<number>;
  getDeletedChats(userId: string): Promise<Chat[]>;
  restoreDeletedChat(chatId: string): Promise<void>;
  permanentlyDeleteChat(chatId: string): Promise<void>;
  // Company Knowledge
  getCompanyKnowledge(userId: string): Promise<CompanyKnowledge[]>;
  getActiveCompanyKnowledge(userId: string): Promise<CompanyKnowledge[]>;
  createCompanyKnowledge(knowledge: InsertCompanyKnowledge): Promise<CompanyKnowledge>;
  updateCompanyKnowledge(id: string, updates: Partial<InsertCompanyKnowledge>): Promise<CompanyKnowledge | null>;
  deleteCompanyKnowledge(id: string): Promise<void>;
  // Gmail OAuth Token operations (Custom MCP)
  getGmailOAuthToken(userId: string): Promise<GmailOAuthToken | null>;
  saveGmailOAuthToken(token: InsertGmailOAuthToken): Promise<GmailOAuthToken>;
  updateGmailOAuthToken(userId: string, updates: Partial<InsertGmailOAuthToken>): Promise<GmailOAuthToken | null>;
  deleteGmailOAuthToken(userId: string): Promise<void>;
  // Message Idempotency operations
  findMessageByRequestId(requestId: string): Promise<ChatMessage | null>;
  claimPendingMessage(messageId: string): Promise<ChatMessage | null>;
  updateMessageStatus(messageId: string, status: 'pending' | 'processing' | 'done' | 'failed'): Promise<ChatMessage | null>;
  updateMessageContent(messageId: string, content: string, additionalData?: Partial<InsertChatMessage>): Promise<ChatMessage | null>;
  findAssistantResponseForUserMessage(userMessageId: string): Promise<ChatMessage | null>;
  // Response Quality Metrics
  recordQualityMetric(metric: InsertResponseQualityMetric): Promise<ResponseQualityMetric>;
  getQualityMetrics(since: Date, limit?: number): Promise<ResponseQualityMetric[]>;
  // Connector Usage Hourly
  upsertConnectorUsage(connector: string, hourBucket: Date, success: boolean, latencyMs: number): Promise<ConnectorUsageHourly>;
  getConnectorUsageStats(connector: string, since: Date): Promise<ConnectorUsageHourly[]>;
  // Offline Message Queue
  createOfflineMessage(message: InsertOfflineMessageQueue): Promise<OfflineMessageQueue>;
  getOfflineMessages(userId: string, status?: string): Promise<OfflineMessageQueue[]>;
  updateOfflineMessageStatus(id: string, status: string, error?: string): Promise<OfflineMessageQueue | null>;
  syncOfflineMessage(id: string): Promise<OfflineMessageQueue | null>;
  // Chat Stats
  updateChatMessageStats(chatId: string): Promise<Chat | undefined>;
  // Provider Metrics
  createProviderMetrics(metrics: InsertProviderMetrics): Promise<ProviderMetrics>;
  getProviderMetrics(provider?: string, startDate?: Date, endDate?: Date): Promise<ProviderMetrics[]>;
  getLatestProviderMetrics(): Promise<ProviderMetrics[]>;
  // Cost Budgets
  getCostBudgets(): Promise<CostBudget[]>;
  getCostBudget(provider: string): Promise<CostBudget | undefined>;
  upsertCostBudget(budget: InsertCostBudget): Promise<CostBudget>;
  // API Logs
  createApiLog(log: InsertApiLog): Promise<ApiLog>;
  getApiLogs(filters: { page?: number; limit?: number; provider?: string; statusCode?: number; startDate?: Date; endDate?: Date }): Promise<{ logs: ApiLog[]; total: number }>;
  getApiLogStats(): Promise<{ byStatusCode: Record<number, number>; byProvider: Record<string, number> }>;
  // KPI Snapshots
  createKpiSnapshot(snapshot: InsertKpiSnapshot): Promise<KpiSnapshot>;
  getLatestKpiSnapshot(): Promise<KpiSnapshot | undefined>;
  getKpiSnapshots(limit?: number): Promise<KpiSnapshot[]>;
  // Analytics Events (extended)
  createAnalyticsEvent(event: InsertAnalyticsEvent): Promise<AnalyticsEvent>;
  getAnalyticsEventStats(startDate?: Date, endDate?: Date): Promise<Record<string, number>>;
  getUserGrowthData(granularity: '1h' | '24h' | '7d' | '30d' | '90d' | '1y'): Promise<{ date: Date; count: number }[]>;
  // Security Policies CRUD
  getSecurityPolicies(): Promise<SecurityPolicy[]>;
  getSecurityPolicy(id: string): Promise<SecurityPolicy | undefined>;
  createSecurityPolicy(policy: InsertSecurityPolicy): Promise<SecurityPolicy>;
  updateSecurityPolicy(id: string, updates: Partial<InsertSecurityPolicy>): Promise<SecurityPolicy | undefined>;
  deleteSecurityPolicy(id: string): Promise<void>;
  toggleSecurityPolicy(id: string, isEnabled: boolean): Promise<SecurityPolicy | undefined>;
  // Report Templates
  getReportTemplates(): Promise<ReportTemplate[]>;
  getReportTemplate(id: string): Promise<ReportTemplate | undefined>;
  createReportTemplate(template: InsertReportTemplate): Promise<ReportTemplate>;
  // Generated Reports
  getGeneratedReports(limit?: number): Promise<GeneratedReport[]>;
  getGeneratedReport(id: string): Promise<GeneratedReport | undefined>;
  createGeneratedReport(report: InsertGeneratedReport): Promise<GeneratedReport>;
  updateGeneratedReport(id: string, updates: Partial<InsertGeneratedReport>): Promise<GeneratedReport | undefined>;
  deleteGeneratedReport(id: string): Promise<void>;
  // Settings Config
  getSettingsConfig(): Promise<SettingsConfig[]>;
  getSettingsConfigByCategory(category: string): Promise<SettingsConfig[]>;
  getSettingsConfigByKey(key: string): Promise<SettingsConfig | undefined>;
  upsertSettingsConfig(setting: InsertSettingsConfig): Promise<SettingsConfig>;
  deleteSettingsConfig(key: string): Promise<void>;
  seedDefaultSettings(): Promise<void>;
  // Agent Gap Logs
  createAgentGapLog(log: InsertAgentGapLog): Promise<AgentGapLog>;
  getAgentGapLogs(status?: string, userId?: string): Promise<AgentGapLog[]>;
  updateAgentGapLog(id: string, updates: Partial<InsertAgentGapLog>): Promise<AgentGapLog | undefined>;
  // Library Folder CRUD
  getLibraryFolders(userId: string): Promise<LibraryFolder[]>;
  getLibraryFolder(id: string, userId: string): Promise<LibraryFolder | null>;
  createLibraryFolder(folder: InsertLibraryFolder): Promise<LibraryFolder>;
  updateLibraryFolder(id: string, userId: string, updates: Partial<InsertLibraryFolder>): Promise<LibraryFolder | null>;
  deleteLibraryFolder(id: string, userId: string): Promise<boolean>;
  // Library Collection CRUD
  getLibraryCollections(userId: string): Promise<LibraryCollection[]>;
  getLibraryCollection(id: string, userId: string): Promise<LibraryCollection | null>;
  createLibraryCollection(collection: InsertLibraryCollection): Promise<LibraryCollection>;
  updateLibraryCollection(id: string, userId: string, updates: Partial<InsertLibraryCollection>): Promise<LibraryCollection | null>;
  deleteLibraryCollection(id: string, userId: string): Promise<boolean>;
  // Library File-Collection Relationship
  addFileToCollection(fileId: string, collectionId: string): Promise<void>;
  removeFileFromCollection(fileId: string, collectionId: string): Promise<boolean>;
  getCollectionFiles(collectionId: string, userId: string): Promise<LibraryFile[]>;
  // Enhanced Library File CRUD
  getLibraryFile(id: string, userId: string): Promise<LibraryFile | null>;
  getLibraryFiles(userId: string, options?: { type?: string; folderId?: string; search?: string }): Promise<LibraryFile[]>;
  createLibraryFile(file: InsertLibraryFile): Promise<LibraryFile>;
  updateLibraryFile(id: string, userId: string, updates: Partial<InsertLibraryFile>): Promise<LibraryFile | null>;
  deleteLibraryFile(id: string, userId: string): Promise<boolean>;
  // Library Storage Stats
  getLibraryStorageStats(userId: string): Promise<LibraryStorageStats | null>;
  upsertLibraryStorageStats(userId: string, stats: Partial<LibraryStorageStats>): Promise<LibraryStorageStats>;
  // Library Activity
  logLibraryActivity(activity: { userId: string; fileId?: number; folderId?: number; collectionId?: number; activityType: string; metadata?: object }): Promise<void>;
  getLibraryActivity(userId: string, limit?: number): Promise<LibraryActivityRecord[]>;
  // Chat Message Analysis operations
  createChatMessageAnalysis(data: InsertChatMessageAnalysis): Promise<ChatMessageAnalysis>;
  getChatMessageAnalysisByUploadId(uploadId: string): Promise<ChatMessageAnalysis | undefined>;
  updateChatMessageAnalysis(id: string, updates: Partial<InsertChatMessageAnalysis>): Promise<ChatMessageAnalysis | undefined>;
  // Conversation Documents - Persistent document context
  createConversationDocument(doc: InsertConversationDocument): Promise<ConversationDocument>;
  getConversationDocuments(chatId: string): Promise<ConversationDocument[]>;
  deleteConversationDocument(id: string): Promise<void>;
  // Admin: User monitoring
  getConversationsByUserId(userId: string): Promise<Chat[]>;
  getMessagesByConversationId(conversationId: string): Promise<ChatMessage[]>;
  deleteConversation(conversationId: string): Promise<void>;
  getAuditLogsByResourceId(resourceId: string): Promise<AuditLog[]>;
  createImpersonationToken(data: { token: string; adminId: string; targetUserId: string; expiresAt: Date }): Promise<void>;
}

export class MemStorage implements IStorage {
  private users: Map<string, User>;

  constructor() {
    this.users = new Map();
  }

  async getUser(id: string): Promise<User | undefined> {
    return cache.remember(`user:${id}`, 300, async () => {
      const [result] = await dbRead.select().from(users).where(eq(users.id, id));
      return result;
    });
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await dbRead.select().from(users).where(eq(users.username, username));
    return user;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
  }

  async createFile(insertFile: InsertFile): Promise<File> {
    const [file] = await db.insert(files).values(insertFile).returning();
    return file;
  }

  async getFile(id: string): Promise<File | undefined> {
    const [file] = await dbRead.select().from(files).where(eq(files.id, id));
    return file;
  }

  async getFileByStoragePath(storagePath: string): Promise<File | undefined> {
    const [file] = await dbRead.select().from(files).where(eq(files.storagePath, storagePath));
    return file;
  }

  async getFiles(userId?: string): Promise<File[]> {
    if (userId) {
      return dbRead.select().from(files).where(eq(files.userId, userId)).orderBy(desc(files.createdAt));
    }
    return dbRead.select().from(files).orderBy(desc(files.createdAt));
  }

  async updateFileStatus(id: string, status: string): Promise<File | undefined> {
    const [file] = await db.update(files).set({ status }).where(eq(files.id, id)).returning();
    return file;
  }

  async deleteFile(id: string): Promise<void> {
    await db.delete(files).where(eq(files.id, id));
  }

  async updateFileProgress(id: string, progress: number): Promise<File | undefined> {
    const [file] = await db.update(files).set({ processingProgress: progress }).where(eq(files.id, id)).returning();
    return file;
  }

  async updateFileError(id: string, error: string): Promise<File | undefined> {
    const [file] = await db.update(files).set({ processingError: error, status: "failed" }).where(eq(files.id, id)).returning();
    return file;
  }

  async updateFileCompleted(id: string): Promise<File | undefined> {
    const [file] = await db.update(files).set({
      status: "completed",
      processingProgress: 100,
      completedAt: new Date()
    }).where(eq(files.id, id)).returning();
    return file;
  }

  async updateFileUploadChunks(id: string, uploadedChunks: number, totalChunks: number): Promise<File | undefined> {
    const [file] = await db.update(files).set({
      uploadedChunks,
      totalChunks
    }).where(eq(files.id, id)).returning();
    return file;
  }

  async createFileJob(job: InsertFileJob): Promise<FileJob> {
    const [result] = await db.insert(fileJobs).values(job).returning();
    return result;
  }

  async getFileJob(fileId: string): Promise<FileJob | undefined> {
    const [result] = await dbRead.select().from(fileJobs).where(eq(fileJobs.fileId, fileId));
    return result;
  }

  async updateFileJobStatus(fileId: string, status: string, error?: string): Promise<FileJob | undefined> {
    const updates: any = { status };
    if (status === "processing") {
      updates.startedAt = new Date();
    }
    if (status === "completed" || status === "failed") {
      updates.completedAt = new Date();
    }
    if (error) {
      updates.lastError = error;
      updates.retries = sql<number>`${fileJobs.retries} + 1` as any;
    }
    const [result] = await db.update(fileJobs).set(updates).where(eq(fileJobs.fileId, fileId)).returning();
    return result;
  }

  async createFileChunks(chunks: InsertFileChunk[]): Promise<FileChunk[]> {
    if (chunks.length === 0) return [];
    const result = await db.insert(fileChunks).values(chunks).returning();
    return result;
  }

  async getFileChunks(fileId: string): Promise<FileChunk[]> {
    return dbRead.select().from(fileChunks).where(eq(fileChunks.fileId, fileId));
  }

  async searchSimilarChunks(embedding: number[], limit: number = 5, userId?: string): Promise<FileChunk[]> {
    const embeddingStr = `[${embedding.join(",")}]`;

    if (userId) {
      const result = await db.execute(sql`
        SELECT fc.*, f.name as file_name,
          fc.embedding <=> ${embeddingStr}::vector AS distance
        FROM file_chunks fc
        JOIN files f ON fc.file_id = f.id
        WHERE fc.embedding IS NOT NULL
          AND f.user_id = ${userId}
        ORDER BY fc.embedding <=> ${embeddingStr}::vector
        LIMIT ${limit}
      `);
      return result.rows as FileChunk[];
    }

    const result = await dbRead.execute(sql`
      SELECT fc.*, f.name as file_name,
        fc.embedding <=> ${embeddingStr}::vector AS distance
      FROM file_chunks fc
      JOIN files f ON fc.file_id = f.id
      WHERE fc.embedding IS NOT NULL
      ORDER BY fc.embedding <=> ${embeddingStr}::vector
      LIMIT ${limit}
    `);
    return result.rows as FileChunk[];
  }

  async updateFileChunkEmbedding(fileId: string, chunkIndex: number, embedding: number[]): Promise<void> {
    await db.update(fileChunks)
      .set({ embedding })
      .where(and(eq(fileChunks.fileId, fileId), eq(fileChunks.chunkIndex, chunkIndex)));
  }

  async createAgentRun(run: InsertAgentRun): Promise<AgentRun> {
    const [result] = await db.insert(agentRuns).values(run).returning();
    return result;
  }

  async getAgentRun(id: string): Promise<AgentRun | undefined> {
    const [result] = await dbRead.select().from(agentRuns).where(eq(agentRuns.id, id));
    return result;
  }

  async getAgentRunsByChatId(chatId: string): Promise<AgentRun[]> {
    return dbRead.select().from(agentRuns).where(eq(agentRuns.conversationId, chatId)).orderBy(desc(agentRuns.startedAt));
  }

  async updateAgentRunStatus(id: string, status: string, error?: string): Promise<AgentRun | undefined> {
    const updates: Partial<AgentRun> = { status };
    if (status === "completed" || status === "failed" || status === "cancelled") {
      updates.completedAt = new Date();
    }
    if (error) {
      updates.error = error;
    }
    const [result] = await db.update(agentRuns).set(updates).where(eq(agentRuns.id, id)).returning();
    return result;
  }

  async createAgentStep(step: InsertAgentStep): Promise<AgentStep> {
    const [result] = await db.insert(agentSteps).values(step).returning();
    return result;
  }

  async getAgentSteps(runId: string): Promise<AgentStep[]> {
    return dbRead.select().from(agentSteps).where(eq(agentSteps.runId, runId)).orderBy(agentSteps.stepIndex);
  }

  async updateAgentStepStatus(id: string, success: string, error?: string): Promise<AgentStep | undefined> {
    const updates: Partial<AgentStep> = { success, completedAt: new Date() };
    if (error) {
      updates.error = error;
    }
    const [result] = await db.update(agentSteps).set(updates).where(eq(agentSteps.id, id)).returning();
    return result;
  }

  async createAgentAsset(asset: InsertAgentAsset): Promise<AgentAsset> {
    const [result] = await db.insert(agentAssets).values(asset).returning();
    return result;
  }

  async getAgentAssets(runId: string): Promise<AgentAsset[]> {
    return dbRead.select().from(agentAssets).where(eq(agentAssets.runId, runId));
  }

  async getDomainPolicy(domain: string): Promise<DomainPolicy | undefined> {
    const [result] = await dbRead.select().from(domainPolicies).where(eq(domainPolicies.domain, domain));
    return result;
  }

  async createDomainPolicy(policy: InsertDomainPolicy): Promise<DomainPolicy> {
    const [result] = await db.insert(domainPolicies).values(policy).returning();
    return result;
  }

  async createChat(chat: InsertChat): Promise<Chat> {
    const [result] = await db.insert(chats).values(chat).returning();
    return result;
  }

  async getChat(id: string): Promise<Chat | undefined> {
    const [fromRead] = await dbRead.select().from(chats).where(eq(chats.id, id));
    if (fromRead) return fromRead;

    // Fallback to primary DB for strong reads (avoid replica lag in write-after-read flows).
    const [fromPrimary] = await db.select().from(chats).where(eq(chats.id, id));
    return fromPrimary;
  }

  async getChats(userId?: string): Promise<Chat[]> {
    if (userId) {
      return dbRead.select()
        .from(chats)
        .where(and(eq(chats.userId, userId), isNull(chats.deletedAt)))
        .orderBy(desc(chats.updatedAt));
    }
    return dbRead.select()
      .from(chats)
      .where(isNull(chats.deletedAt))
      .orderBy(desc(chats.updatedAt));
  }

  async getActiveChats(userId: string): Promise<Chat[]> {
    return dbRead
      .select()
      .from(chats)
      .where(
        and(
          eq(chats.userId, userId),
          // Handle legacy boolean vs string text column
          or(
            eq(chats.archived, "false"),
            isNull(chats.archived)
          ),
          isNull(chats.deletedAt)
        )
      )
      .orderBy(desc(chats.updatedAt));
  }

  async updateChat(id: string, updates: Partial<InsertChat>): Promise<Chat | undefined> {
    const [result] = await db.update(chats).set({ ...updates, updatedAt: new Date() }).where(eq(chats.id, id)).returning();
    return result;
  }

  async deleteChat(id: string): Promise<void> {
    await db.delete(chats).where(eq(chats.id, id));
  }

  async createChatMessage(message: InsertChatMessage): Promise<ChatMessage> {
    const [result] = await db.insert(chatMessages).values(message).returning();
    queueMicrotask(() => {
      db.update(chats)
        .set({ updatedAt: new Date() })
        .where(eq(chats.id, message.chatId))
        .catch((error) => {
          console.warn("[Chats] Failed to update chat updatedAt after message create:", error?.message || error);
        });
    });
    if (message.role === "user" || message.role === "assistant") {
      queueMicrotask(() => {
        knowledgeBaseService.ingestChatMessage({
          chatId: message.chatId,
          messageId: result.id,
          role: message.role,
          content: message.content,
        }).catch((error) => {
          console.warn("[Knowledge] Failed to ingest chat message:", error?.message || error);
        });
      });
    }
    return result;
  }

  async getChatMessage(chatId: string, messageId: string): Promise<ChatMessage | undefined> {
    const [fromRead] = await dbRead
      .select()
      .from(chatMessages)
      .where(and(eq(chatMessages.chatId, chatId), eq(chatMessages.id, messageId)));
    if (fromRead) return fromRead;

    // Fallback to primary DB for strong reads (avoid replica lag in idempotency flows).
    const [fromPrimary] = await db
      .select()
      .from(chatMessages)
      .where(and(eq(chatMessages.chatId, chatId), eq(chatMessages.id, messageId)));
    return fromPrimary;
  }

  async getChatMessages(chatId: string, options?: { limit?: number; offset?: number; before?: Date; orderBy?: 'asc' | 'desc' }): Promise<ChatMessage[]> {
    const { limit, offset, before, orderBy = 'asc' } = options || {};
    // Cache key includes pagination params
    const cacheKey = `messages:${chatId}:${limit || 'all'}:${offset || 0}:${before?.getTime() || 'now'}:${orderBy}`;

    return cache.remember(cacheKey, 10, async () => {
      let query = dbRead.select().from(chatMessages).where(eq(chatMessages.chatId, chatId));

      if (before) {
        // Cursor pagination
        query.where(and(eq(chatMessages.chatId, chatId), sql`${chatMessages.createdAt} < ${before.toISOString()}`));
      }

      if (orderBy === 'desc') {
        query.orderBy(desc(chatMessages.createdAt));
      } else {
        query.orderBy(chatMessages.createdAt);
      }

      if (limit) {
        query.limit(limit);
      }

      if (offset) {
        query.offset(offset);
      }

      return await query;
    });
  }

  async searchMessages(userId: string, query: string): Promise<ChatMessage[]> {
    // Sanitize query to avoid syntax errors in websearch_to_tsquery

    const sanitizedQuery = query.replace(/[^\w\sñáéíóúü]/gi, ' ').trim();
    if (!sanitizedQuery) return [];

    // Use Read Replica for search queries to offload primary
    const result = await dbRead.execute(sql`
      SELECT m.* 
      FROM chat_messages m
      JOIN chats c ON m.chat_id = c.id
      WHERE c.user_id = ${userId}
      AND c.deleted_at IS NULL
      AND m.search_vector @@ websearch_to_tsquery('spanish', ${sanitizedQuery})
      ORDER BY ts_rank(m.search_vector, websearch_to_tsquery('spanish', ${sanitizedQuery})) DESC
      LIMIT 50
    `);

    return result.rows as ChatMessage[];
  }




  async updateChatMessageContent(id: string, content: string, status: string, metadata?: Record<string, any>): Promise<ChatMessage | undefined> {
    const updateData: any = { content, status };
    if (metadata) {
      updateData.metadata = metadata;
    }
    const [result] = await db.update(chatMessages)
      .set(updateData)
      .where(eq(chatMessages.id, id))
      .returning();
    return result;
  }

  async createChatWithMessages(chat: InsertChat, messages: Partial<InsertChatMessage>[]): Promise<{ chat: Chat; messages: ChatMessage[] }> {
    const result = await db.transaction(async (tx) => {
      // Create chat first
      const [createdChat] = await tx.insert(chats).values(chat).returning();

      // Insert all messages with the chatId
      const savedMessages: ChatMessage[] = [];
      for (const msg of messages) {
        const [savedMsg] = await tx.insert(chatMessages).values({
          chatId: createdChat.id,
          role: msg.role!,
          content: msg.content!,
          requestId: msg.requestId,
          userMessageId: msg.userMessageId,
          attachments: msg.attachments
        }).returning();
        savedMessages.push(savedMsg);
      }

      return { chat: createdChat, messages: savedMessages };
    });
    if (result.messages.length > 0) {
      queueMicrotask(() => {
        for (const msg of result.messages) {
          if (msg.role === "user" || msg.role === "assistant") {
            knowledgeBaseService.ingestChatMessage({
              chatId: result.chat.id,
              messageId: msg.id,
              role: msg.role,
              content: msg.content,
            }).catch((error) => {
              console.warn("[Knowledge] Failed to ingest chat message:", error?.message || error);
            });
          }
        }
      });
    }
    return result;
  }

  async saveDocumentToChat(chatId: string, document: { type: string; title: string; content: string }): Promise<ChatMessage> {
    // Find the last "Documento generado correctamente" message to attach the document to
    const messages = await db.select().from(chatMessages)
      .where(and(
        eq(chatMessages.chatId, chatId),
        eq(chatMessages.role, "assistant")
      ))
      .orderBy(desc(chatMessages.createdAt));

    const docGenMessage = messages.find(m =>
      m.content?.includes("Documento generado correctamente") ||
      m.content?.includes("Presentación generada correctamente")
    );

    const attachment = {
      type: "document",
      name: document.title,
      documentType: document.type,
      title: document.title,
      content: document.content,
      savedAt: new Date().toISOString()
    };

    if (docGenMessage) {
      // Update existing message with the document attachment
      const existingAttachments = Array.isArray(docGenMessage.attachments) ? docGenMessage.attachments : [];
      const [result] = await db.update(chatMessages)
        .set({ attachments: [...existingAttachments, attachment] })
        .where(eq(chatMessages.id, docGenMessage.id))
        .returning();
      await db.update(chats).set({ updatedAt: new Date() }).where(eq(chats.id, chatId));
      return result;
    } else {
      // Fallback: create new system message if no "Documento generado" message found
      const [result] = await db.insert(chatMessages).values({
        chatId,
        role: "system",
        content: `Documento guardado: ${document.title}`,
        attachments: [attachment],
        status: "done"
      }).returning();
      await db.update(chats).set({ updatedAt: new Date() }).where(eq(chats.id, chatId));
      return result;
    }
  }

  // Chat Run operations (for idempotent message processing)
  async createChatRun(run: InsertChatRun): Promise<ChatRun> {
    const [result] = await db.insert(chatRuns).values(run).returning();
    return result;
  }

  async getChatRun(id: string): Promise<ChatRun | undefined> {
    const [result] = await dbRead.select().from(chatRuns).where(eq(chatRuns.id, id));
    return result;
  }

  async getChatRunByClientRequestId(chatId: string, clientRequestId: string): Promise<ChatRun | undefined> {
    const [fromRead] = await dbRead.select().from(chatRuns).where(
      and(eq(chatRuns.chatId, chatId), eq(chatRuns.clientRequestId, clientRequestId))
    );
    if (fromRead) return fromRead;

    // Fallback to primary DB for strong reads (avoid replica lag in idempotency flows).
    const [fromPrimary] = await db.select().from(chatRuns).where(
      and(eq(chatRuns.chatId, chatId), eq(chatRuns.clientRequestId, clientRequestId))
    );
    return fromPrimary;
  }

  async claimPendingRun(chatId: string, clientRequestId?: string): Promise<ChatRun | undefined> {
    // If clientRequestId is provided, claim that specific run
    if (clientRequestId) {
      const [result] = await db.update(chatRuns)
        .set({ status: 'processing', startedAt: new Date() })
        .where(and(
          eq(chatRuns.chatId, chatId),
          eq(chatRuns.clientRequestId, clientRequestId),
          eq(chatRuns.status, 'pending')
        ))
        .returning();
      return result;
    }
    // Otherwise claim any pending run for the chat
    const [result] = await db.update(chatRuns)
      .set({ status: 'processing', startedAt: new Date() })
      .where(and(eq(chatRuns.chatId, chatId), eq(chatRuns.status, 'pending')))
      .returning();
    return result;
  }

  async updateChatRunStatus(id: string, status: string, error?: string): Promise<ChatRun | undefined> {
    const updates: any = { status };
    if (status === 'done' || status === 'failed') {
      updates.completedAt = new Date();
    }
    if (status === 'pending') {
      // Reset run to pristine state for re-claiming (stale recovery / replace)
      updates.startedAt = null;
      updates.completedAt = null;
      updates.error = null;
    }
    if (error) {
      updates.error = error;
    }
    const [result] = await db.update(chatRuns).set(updates).where(eq(chatRuns.id, id)).returning();
    return result;
  }

  async updateChatRunAssistantMessage(id: string, assistantMessageId: string): Promise<ChatRun | undefined> {
    const [result] = await db.update(chatRuns)
      .set({ assistantMessageId })
      .where(eq(chatRuns.id, id))
      .returning();
    return result;
  }

  async updateChatRunLastSeq(id: string, lastSeq: number): Promise<ChatRun | undefined> {
    const [result] = await db.update(chatRuns)
      .set({ lastSeq })
      .where(eq(chatRuns.id, id))
      .returning();
    return result;
  }

  async createUserMessageAndRun(chatId: string, message: InsertChatMessage, clientRequestId: string): Promise<{ message: ChatMessage; run: ChatRun }> {
    const messageId = message.id || randomUUID();
    const runId = randomUUID();

    const messageToInsert: InsertChatMessage = {
      ...message,
      id: messageId,
      runId,
    };

    const runToInsert: InsertChatRun = {
      id: runId,
      chatId,
      clientRequestId,
      userMessageId: messageId,
      status: "pending",
    };

    const result = await db.transaction(async (tx) => {
      const [savedMessage] = await tx.insert(chatMessages).values(messageToInsert).returning();
      const [run] = await tx.insert(chatRuns).values(runToInsert).returning();
      return { message: savedMessage, run };
    });

    // Best-effort: bump chat updatedAt without blocking the user's round trip.
    queueMicrotask(() => {
      db.update(chats)
        .set({ updatedAt: new Date() })
        .where(eq(chats.id, chatId))
        .catch((err) => {
          console.warn("[Chats] Failed to update updatedAt after message+run create:", err?.message || err);
        });
    });

    return result;
  }

  // Tool Invocation operations
  async createToolInvocation(invocation: InsertToolInvocation): Promise<ToolInvocation> {
    const [result] = await db.insert(toolInvocations).values(invocation).returning();
    return result;
  }

  async getToolInvocation(runId: string, toolCallId: string): Promise<ToolInvocation | undefined> {
    const [result] = await dbRead.select().from(toolInvocations).where(
      and(eq(toolInvocations.runId, runId), eq(toolInvocations.toolCallId, toolCallId))
    );
    return result;
  }

  async updateToolInvocationResult(id: string, output: any, status: string, error?: string): Promise<ToolInvocation | undefined> {
    const updates: any = { output, status };
    if (status === 'done' || status === 'failed') {
      updates.completedAt = new Date();
    }
    if (error) {
      updates.error = error;
    }
    const [result] = await db.update(toolInvocations).set(updates).where(eq(toolInvocations.id, id)).returning();
    return result;
  }

  // Chat Share operations
  async createChatShare(share: InsertChatShare): Promise<ChatShare> {
    const [result] = await db.insert(chatShares).values(share).returning();
    return result;
  }

  async getChatShares(chatId: string): Promise<ChatShare[]> {
    return dbRead.select().from(chatShares).where(eq(chatShares.chatId, chatId)).orderBy(desc(chatShares.createdAt));
  }

  async getChatSharesByEmail(email: string): Promise<ChatShare[]> {
    const normalizedEmail = email.toLowerCase().trim();
    return dbRead.select().from(chatShares).where(sql`LOWER(${chatShares.email}) = ${normalizedEmail}`).orderBy(desc(chatShares.createdAt));
  }

  async getChatSharesByUserId(userId: string): Promise<ChatShare[]> {
    return dbRead.select().from(chatShares).where(eq(chatShares.recipientUserId, userId)).orderBy(desc(chatShares.createdAt));
  }

  async getSharedChatsWithDetails(userId: string): Promise<(Chat & { shareRole: string; shareId: string })[]> {
    const results = await dbRead
      .select({
        id: chats.id,
        title: chats.title,
        userId: chats.userId,
        gptId: chats.gptId,
        archived: chats.archived,
        hidden: chats.hidden,
        deletedAt: chats.deletedAt,
        createdAt: chats.createdAt,
        updatedAt: chats.updatedAt,
        shareRole: chatShares.role,
        shareId: chatShares.id,
      })
      .from(chatShares)
      .innerJoin(chats, eq(chatShares.chatId, chats.id))
      .where(eq(chatShares.recipientUserId, userId))
      .orderBy(desc(chatShares.createdAt));

    return results as (Chat & { shareRole: string; shareId: string })[];
  }

  async getChatShareByEmailAndChat(email: string, chatId: string): Promise<ChatShare | undefined> {
    const normalizedEmail = email.toLowerCase().trim();
    const [result] = await dbRead.select().from(chatShares)
      .where(sql`LOWER(${chatShares.email}) = ${normalizedEmail} AND ${chatShares.chatId} = ${chatId}`);
    return result;
  }

  async getChatShareByUserAndChat(userId: string, chatId: string): Promise<ChatShare | undefined> {
    const [result] = await dbRead.select().from(chatShares)
      .where(sql`${chatShares.recipientUserId} = ${userId} AND ${chatShares.chatId} = ${chatId}`);
    return result;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const normalizedEmail = email.toLowerCase().trim();
    const [result] = await dbRead.select().from(users).where(ilike(users.email, normalizedEmail));
    return result;
  }

  async updateChatShare(id: string, updates: Partial<InsertChatShare>): Promise<ChatShare | undefined> {
    const [result] = await db.update(chatShares).set(updates).where(eq(chatShares.id, id)).returning();
    return result;
  }

  async deleteChatShare(id: string): Promise<void> {
    await db.delete(chatShares).where(eq(chatShares.id, id));
  }

  // GPT operations
  async createGpt(gpt: InsertGpt): Promise<Gpt> {
    const [result] = await db.insert(gpts).values(gpt).returning();
    return result;
  }

  async getGpt(id: string): Promise<Gpt | undefined> {
    const [result] = await dbRead.select().from(gpts).where(eq(gpts.id, id));
    return result;
  }

  async getGptBySlug(slug: string): Promise<Gpt | undefined> {
    const [result] = await dbRead.select().from(gpts).where(eq(gpts.slug, slug));
    return result;
  }

  async getGpts(filters?: { visibility?: string; categoryId?: string; creatorId?: string }): Promise<Gpt[]> {
    let query = dbRead.select().from(gpts);
    if (filters?.visibility) {
      query = query.where(eq(gpts.visibility, filters.visibility)) as typeof query;
    }
    if (filters?.categoryId) {
      query = query.where(eq(gpts.categoryId, filters.categoryId)) as typeof query;
    }
    if (filters?.creatorId) {
      query = query.where(eq(gpts.creatorId, filters.creatorId)) as typeof query;
    }
    return query.orderBy(desc(gpts.createdAt));
  }

  async getPopularGpts(limit: number = 10): Promise<Gpt[]> {
    return dbRead.select().from(gpts)
      .where(eq(gpts.visibility, "public"))
      .orderBy(desc(gpts.usageCount))
      .limit(limit);
  }

  async updateGpt(id: string, updates: Partial<InsertGpt>): Promise<Gpt | undefined> {
    const [result] = await db.update(gpts).set({ ...updates, updatedAt: new Date() }).where(eq(gpts.id, id)).returning();
    return result;
  }

  async deleteGpt(id: string): Promise<void> {
    await db.delete(gpts).where(eq(gpts.id, id));
  }

  async incrementGptUsage(id: string): Promise<void> {
    await db.update(gpts).set({ usageCount: sql`${gpts.usageCount} + 1` }).where(eq(gpts.id, id));
  }

  async getGptConversationCount(gptId: string): Promise<number> {
    const [result] = await dbRead.select({ count: sql<number>`count(*)::int` })
      .from(chats)
      .where(eq(chats.gptId, gptId));
    return result?.count || 0;
  }

  // GPT Category operations
  async createGptCategory(category: InsertGptCategory): Promise<GptCategory> {
    const [result] = await db.insert(gptCategories).values(category).returning();
    return result;
  }

  async getGptCategories(): Promise<GptCategory[]> {
    return dbRead.select().from(gptCategories).orderBy(gptCategories.sortOrder);
  }

  // GPT Version operations
  async createGptVersion(version: InsertGptVersion): Promise<GptVersion> {
    const [result] = await db.insert(gptVersions).values(version).returning();
    return result;
  }

  async getGptVersions(gptId: string): Promise<GptVersion[]> {
    return dbRead.select().from(gptVersions).where(eq(gptVersions.gptId, gptId)).orderBy(desc(gptVersions.versionNumber));
  }

  async getLatestGptVersion(gptId: string): Promise<GptVersion | undefined> {
    const [result] = await dbRead.select().from(gptVersions)
      .where(eq(gptVersions.gptId, gptId))
      .orderBy(desc(gptVersions.versionNumber))
      .limit(1);
    return result;
  }

  async getGptVersionByNumber(gptId: string, versionNumber: number): Promise<GptVersion | undefined> {
    const [result] = await dbRead.select().from(gptVersions)
      .where(and(eq(gptVersions.gptId, gptId), eq(gptVersions.versionNumber, versionNumber)))
      .limit(1);
    return result;
  }

  // GPT Knowledge operations
  async createGptKnowledge(knowledge: InsertGptKnowledge): Promise<GptKnowledge> {
    const [result] = await db.insert(gptKnowledge).values(knowledge).returning();
    return result;
  }

  async getGptKnowledge(gptId: string): Promise<GptKnowledge[]> {
    return dbRead.select().from(gptKnowledge)
      .where(and(eq(gptKnowledge.gptId, gptId), eq(gptKnowledge.isActive, "true")))
      .orderBy(desc(gptKnowledge.createdAt));
  }

  async getGptKnowledgeById(id: string): Promise<GptKnowledge | undefined> {
    const [result] = await dbRead.select().from(gptKnowledge).where(eq(gptKnowledge.id, id));
    return result;
  }

  async updateGptKnowledge(id: string, updates: Partial<InsertGptKnowledge>): Promise<GptKnowledge | undefined> {
    const [result] = await db.update(gptKnowledge)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(gptKnowledge.id, id))
      .returning();
    return result;
  }

  async deleteGptKnowledge(id: string): Promise<void> {
    await db.update(gptKnowledge).set({ isActive: "false" }).where(eq(gptKnowledge.id, id));
  }

  // GPT Actions operations
  async createGptAction(action: InsertGptAction): Promise<GptAction> {
    const [result] = await db.insert(gptActions).values(action).returning();
    return result;
  }

  async getGptActions(gptId: string): Promise<GptAction[]> {
    return dbRead.select().from(gptActions)
      .where(and(eq(gptActions.gptId, gptId), eq(gptActions.isActive, "true")))
      .orderBy(gptActions.name);
  }

  async getGptActionById(id: string): Promise<GptAction | undefined> {
    const [result] = await dbRead.select().from(gptActions).where(eq(gptActions.id, id));
    return result;
  }

  async getGptActionByIdAndGpt(actionId: string, gptId: string): Promise<GptAction | undefined> {
    const [result] = await dbRead.select().from(gptActions)
      .where(and(eq(gptActions.id, actionId), eq(gptActions.gptId, gptId)));
    return result;
  }

  async updateGptAction(id: string, updates: Partial<InsertGptAction>): Promise<GptAction | undefined> {
    const [result] = await db.update(gptActions)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(gptActions.id, id))
      .returning();
    return result;
  }

  async deleteGptAction(id: string): Promise<void> {
    await db.update(gptActions).set({ isActive: "false" }).where(eq(gptActions.id, id));
  }

  async incrementGptActionUsage(id: string): Promise<void> {
    await db.update(gptActions)
      .set({ usageCount: sql`${gptActions.usageCount} + 1`, lastUsedAt: new Date() })
      .where(eq(gptActions.id, id));
  }

  // Sidebar Pinned GPTs
  async getSidebarPinnedGpts(userId: string): Promise<any[]> {
    try {
      const pinnedRecords = await dbRead.select()
        .from(sidebarPinnedGpts)
        .where(eq(sidebarPinnedGpts.userId, userId))
        .orderBy(sidebarPinnedGpts.displayOrder);

      const gptDetails = await Promise.all(
        pinnedRecords.map(async (record) => {
          const gpt = await this.getGpt(record.gptId);
          return gpt ? { ...record, gpt } : null;
        })
      );

      return gptDetails.filter(Boolean);
    } catch (error) {
      // Fallback to raw SQL in case Drizzle query compilation fails for this environment.
      console.error("[storage] sidebarPinnedGpts query failed, falling back to raw SQL", error);
      const result = await dbRead.execute(sql`
        SELECT id, user_id, gpt_id, display_order, pinned_at
        FROM sidebar_pinned_gpts
        WHERE user_id = ${userId}
        ORDER BY display_order`
      );

      const records = result.rows as Array<{
        id: string;
        user_id: string;
        gpt_id: string;
        display_order: number;
        pinned_at: Date;
      }>;

      const gptDetails = await Promise.all(
        records.map(async (record) => {
          const gpt = await this.getGpt(record.gpt_id);
          return gpt
            ? {
              id: record.id,
              userId: record.user_id,
              gptId: record.gpt_id,
              displayOrder: record.display_order,
              pinnedAt: record.pinned_at,
              gpt,
            }
            : null;
        })
      );

      return gptDetails.filter(Boolean);
    }
  }
  async pinGptToSidebar(userId: string, gptId: string, displayOrder: number = 0): Promise<any> {
    const existing = await db.select()
      .from(sidebarPinnedGpts)
      .where(and(eq(sidebarPinnedGpts.userId, userId), eq(sidebarPinnedGpts.gptId, gptId)));

    if (existing.length > 0) {
      return existing[0];
    }

    const [result] = await db.insert(sidebarPinnedGpts)
      .values({ userId, gptId, displayOrder })
      .returning();
    return result;
  }

  async unpinGptFromSidebar(userId: string, gptId: string): Promise<void> {
    await db.delete(sidebarPinnedGpts)
      .where(and(eq(sidebarPinnedGpts.userId, userId), eq(sidebarPinnedGpts.gptId, gptId)));
  }

  async isGptPinnedToSidebar(userId: string, gptId: string): Promise<boolean> {
    const [result] = await dbRead.select()
      .from(sidebarPinnedGpts)
      .where(and(eq(sidebarPinnedGpts.userId, userId), eq(sidebarPinnedGpts.gptId, gptId)));
    return !!result;
  }

  // Admin: User management
  async getAllUsers(): Promise<User[]> {
    return dbRead.select().from(users).orderBy(desc(users.createdAt));
  }

  async updateUser(id: string, updates: Partial<User>): Promise<User | undefined> {
    const [result] = await db.update(users).set(updates).where(eq(users.id, id)).returning();
    if (result) {
      await cache.delete(`user:${id}`);
    }
    return result;
  }

  async deleteUser(id: string): Promise<void> {
    await db.delete(users).where(eq(users.id, id));
  }

  async getUserStats(): Promise<{ total: number; active: number; newThisMonth: number; newLastMonth: number }> {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    const [row] = await dbRead
      .select({
        total: sql<number>`count(*)`,
        active: sql<number>`count(*) filter (where ${users.status} = 'active')`,
        newThisMonth: sql<number>`count(*) filter (where ${users.createdAt} >= ${monthStart})`,
        newLastMonth: sql<number>`count(*) filter (where ${users.createdAt} >= ${lastMonthStart} and ${users.createdAt} < ${monthStart})`,
      })
      .from(users);

    return {
      total: Number(row?.total ?? 0),
      active: Number(row?.active ?? 0),
      newThisMonth: Number(row?.newThisMonth ?? 0),
      newLastMonth: Number(row?.newLastMonth ?? 0),
    };
  }

  // Admin: AI Models
  async createAiModel(model: InsertAiModel): Promise<AiModel> {
    const [result] = await db.insert(aiModels).values(model).returning();
    return result;
  }

  async getAiModels(): Promise<AiModel[]> {
    return dbRead.select().from(aiModels).orderBy(desc(aiModels.createdAt));
  }

  async getAiModelsFiltered(filters: { provider?: string; providers?: string[]; type?: string; status?: string; search?: string; sortBy?: string; sortOrder?: string; page?: number; limit?: number }): Promise<{ models: AiModel[]; total: number }> {
    const { provider, providers, type, status, search, sortBy = "name", sortOrder = "asc", page = 1, limit = 20 } = filters;
    const conditions = [];

    if (provider) {
      conditions.push(eq(aiModels.provider, provider.toLowerCase()));
    }
    if (providers && providers.length > 0) {
      const normalizedProviders = providers.map((p) => String(p).toLowerCase().trim()).filter(Boolean);
      if (normalizedProviders.length > 0) {
        conditions.push(inArray(aiModels.provider, normalizedProviders));
      }
    }
    if (type) {
      conditions.push(eq(aiModels.modelType, type));
    }
    if (status) {
      conditions.push(eq(aiModels.status, status));
    }
    if (search) {
      conditions.push(
        sql`(${aiModels.name} ILIKE ${`%${search}%`} OR ${aiModels.modelId} ILIKE ${`%${search}%`} OR ${aiModels.description} ILIKE ${`%${search}%`})`
      );
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const safePage = Math.max(1, Number(page) || 1);
    const safeLimit = Math.min(100, Math.max(1, Number(limit) || 20));
    const offset = (safePage - 1) * safeLimit;

    const normalizedSortOrder = sortOrder === "desc" ? "desc" : "asc";
    const normalizedSortBy = new Set(["name", "provider", "modelType", "contextWindow", "createdAt", "lastSyncAt"]).has(sortBy)
      ? sortBy
      : "name";

    let sortCol: any = aiModels.name;
    switch (normalizedSortBy) {
      case "provider": sortCol = aiModels.provider; break;
      case "modelType": sortCol = aiModels.modelType; break;
      case "contextWindow": sortCol = aiModels.contextWindow; break;
      case "createdAt": sortCol = aiModels.createdAt; break;
      case "lastSyncAt": sortCol = aiModels.lastSyncAt; break;
      case "name":
      default:
        sortCol = aiModels.name;
        break;
    }

    const orderExpr = normalizedSortOrder === "desc" ? desc(sortCol) : sortCol;

    const countQuery = dbRead
      .select({ count: sql<number>`count(*)::int` })
      .from(aiModels);
    if (whereClause) countQuery.where(whereClause);

    const [countRow] = await countQuery;
    const total = countRow?.count || 0;

    const modelsQuery = dbRead.select().from(aiModels);
    if (whereClause) modelsQuery.where(whereClause);

    const models = await modelsQuery
      .orderBy(orderExpr, aiModels.id)
      .limit(safeLimit)
      .offset(offset);

    return { models, total };
  }

  async getAiModelById(id: string): Promise<AiModel | undefined> {
    const [result] = await dbRead.select().from(aiModels).where(eq(aiModels.id, id));
    return result;
  }

  async getAiModelByModelId(modelId: string, provider: string): Promise<AiModel | undefined> {
    const [result] = await dbRead.select().from(aiModels).where(
      and(eq(aiModels.modelId, modelId), eq(aiModels.provider, provider.toLowerCase()))
    );
    return result;
  }

  async updateAiModel(id: string, updates: Partial<InsertAiModel>): Promise<AiModel | undefined> {
    const [result] = await db.update(aiModels).set(updates).where(eq(aiModels.id, id)).returning();
    return result;
  }

  async deleteAiModel(id: string): Promise<void> {
    await db.delete(aiModels).where(eq(aiModels.id, id));
  }

  // Admin: Payments
  async createPayment(payment: InsertPayment): Promise<Payment> {
    const normalizedPayment = normalizeStoredMoneyFields(payment);
    const [result] = await db.insert(payments).values(normalizedPayment).returning();
    return result;
  }

  async getPayments(): Promise<Payment[]> {
    return dbRead.select().from(payments).orderBy(desc(payments.createdAt));
  }

  async updatePayment(id: string, updates: Partial<InsertPayment>): Promise<Payment | undefined> {
    const normalizedUpdates =
      updates.amount !== undefined ||
      updates.amountValue !== undefined ||
      updates.amountMinor !== undefined ||
      updates.currency !== undefined
        ? normalizeStoredMoneyFields(updates)
        : updates;
    const [result] = await db.update(payments).set(normalizedUpdates).where(eq(payments.id, id)).returning();
    return result;
  }

  async getPaymentStats(): Promise<{ total: string; thisMonth: string; previousMonth: string; count: number }> {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    const [row] = await dbRead
      .select({
        total: sql<number>`coalesce(sum((nullif(${payments.amount}, '')::numeric)) filter (where ${payments.status} = 'completed'), 0)`,
        thisMonth: sql<number>`coalesce(sum((nullif(${payments.amount}, '')::numeric)) filter (where ${payments.status} = 'completed' and ${payments.createdAt} >= ${monthStart}), 0)`,
        previousMonth: sql<number>`coalesce(sum((nullif(${payments.amount}, '')::numeric)) filter (where ${payments.status} = 'completed' and ${payments.createdAt} >= ${lastMonthStart} and ${payments.createdAt} < ${monthStart}), 0)`,
        count: sql<number>`count(*) filter (where ${payments.status} = 'completed')`,
      })
      .from(payments);

    return {
      total: Number(row?.total ?? 0).toFixed(2),
      thisMonth: Number(row?.thisMonth ?? 0).toFixed(2),
      previousMonth: Number(row?.previousMonth ?? 0).toFixed(2),
      count: Number(row?.count ?? 0),
    };
  }

  // Admin: Invoices
  async createInvoice(invoice: InsertInvoice): Promise<Invoice> {
    const normalizedInvoice = normalizeStoredMoneyFields(invoice);
    const [result] = await db.insert(invoices).values(normalizedInvoice).returning();
    return result;
  }

  async getInvoices(): Promise<Invoice[]> {
    return dbRead.select().from(invoices).orderBy(desc(invoices.createdAt));
  }

  async updateInvoice(id: string, updates: Partial<InsertInvoice>): Promise<Invoice | undefined> {
    const normalizedUpdates =
      updates.amount !== undefined ||
      updates.amountValue !== undefined ||
      updates.amountMinor !== undefined ||
      updates.currency !== undefined
        ? normalizeStoredMoneyFields(updates)
        : updates;
    const [result] = await db.update(invoices).set(normalizedUpdates).where(eq(invoices.id, id)).returning();
    return result;
  }

  // Admin: Settings
  async getSetting(key: string): Promise<PlatformSetting | undefined> {
    return cache.remember(`setting:${key}`, 300, async () => {
      const [result] = await dbRead.select().from(platformSettings).where(eq(platformSettings.key, key));
      return result;
    });
  }

  async getSettings(): Promise<PlatformSetting[]> {
    return cache.remember('settings:all', 300, async () => {
      return dbRead.select().from(platformSettings).orderBy(platformSettings.category);
    });
  }

  async upsertSetting(key: string, value: string, description?: string, category?: string): Promise<PlatformSetting> {
    const existing = await this.getSetting(key);
    if (existing) {
      const [result] = await db.update(platformSettings)
        .set({ value, description, category, updatedAt: new Date() })
        .where(eq(platformSettings.key, key))
        .returning();
      await cache.delete(`setting:${key}`);
      await cache.delete('settings:all');
      return result;
    }
    const [result] = await db.insert(platformSettings)
      .values({ key, value, description, category })
      .returning();
    await cache.delete(`setting:${key}`);
    await cache.delete('settings:all');
    return result;
  }

  // Admin: Audit Logs
  async createAuditLog(log: InsertAuditLog): Promise<AuditLog> {
    const [result] = await db.insert(auditLogs).values(log).returning();
    return result;
  }

  async getAuditLogs(limit: number = 100): Promise<AuditLog[]> {
    return dbRead.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(limit);
  }

  // Admin: Analytics
  async createAnalyticsSnapshot(snapshot: InsertAnalyticsSnapshot): Promise<AnalyticsSnapshot> {
    const [result] = await db.insert(analyticsSnapshots).values(snapshot).returning();
    return result;
  }

  async getAnalyticsSnapshots(days: number = 30): Promise<AnalyticsSnapshot[]> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    return dbRead.select().from(analyticsSnapshots)
      .where(sql`${analyticsSnapshots.date} >= ${cutoff}`)
      .orderBy(analyticsSnapshots.date);
  }

  async getDashboardMetrics(): Promise<{ users: number; queries: number; revenue: string; uptime: number }> {
    const userStats = await this.getUserStats();
    const paymentStats = await this.getPaymentStats();
    const [row] = await dbRead
      .select({
        totalQueries: sql<number>`coalesce(sum(${users.queryCount}), 0)`,
      })
      .from(users);
    const totalQueries = Number(row?.totalQueries ?? 0);
    return {
      users: userStats.total,
      queries: totalQueries,
      revenue: paymentStats.total,
      uptime: 99.9
    };
  }

  // Admin: Reports
  async createReport(report: InsertReport): Promise<Report> {
    const [result] = await db.insert(reports).values(report).returning();
    return result;
  }

  async getReports(): Promise<Report[]> {
    return dbRead.select().from(reports).orderBy(desc(reports.createdAt));
  }

  async updateReport(id: string, updates: Partial<InsertReport>): Promise<Report | undefined> {
    const [result] = await db.update(reports).set(updates).where(eq(reports.id, id)).returning();
    return result;
  }

  // Admin: Domain Policies
  async getDomainPolicies(): Promise<DomainPolicy[]> {
    return dbRead.select().from(domainPolicies).orderBy(desc(domainPolicies.createdAt));
  }

  async updateDomainPolicy(id: string, updates: Partial<InsertDomainPolicy>): Promise<DomainPolicy | undefined> {
    const [result] = await db.update(domainPolicies).set(updates).where(eq(domainPolicies.id, id)).returning();
    return result;
  }

  async deleteDomainPolicy(id: string): Promise<void> {
    await db.delete(domainPolicies).where(eq(domainPolicies.id, id));
  }

  // Library Items CRUD
  async createLibraryItem(item: InsertLibraryItem): Promise<LibraryItem> {
    const [result] = await db.insert(libraryItems).values(item).returning();
    return result;
  }

  async getLibraryItems(userId: string, mediaType?: string): Promise<LibraryItem[]> {
    if (mediaType) {
      return dbRead.select().from(libraryItems)
        .where(sql`${libraryItems.userId} = ${userId} AND ${libraryItems.mediaType} = ${mediaType}`)
        .orderBy(desc(libraryItems.createdAt));
    }
    return dbRead.select().from(libraryItems)
      .where(eq(libraryItems.userId, userId))
      .orderBy(desc(libraryItems.createdAt));
  }

  async getLibraryItem(id: string, userId: string): Promise<LibraryItem | null> {
    const [result] = await dbRead.select().from(libraryItems)
      .where(sql`${libraryItems.id} = ${id} AND ${libraryItems.userId} = ${userId}`);
    return result || null;
  }

  async deleteLibraryItem(id: string, userId: string): Promise<boolean> {
    const result = await db.delete(libraryItems)
      .where(sql`${libraryItems.id} = ${id} AND ${libraryItems.userId} = ${userId}`)
      .returning();
    return result.length > 0;
  }

  // Notification Preferences
  async getNotificationEventTypes(): Promise<NotificationEventType[]> {
    return dbRead.select().from(notificationEventTypes).orderBy(notificationEventTypes.sortOrder);
  }

  async getNotificationPreferences(userId: string): Promise<NotificationPreference[]> {
    return dbRead.select().from(notificationPreferences).where(eq(notificationPreferences.userId, userId));
  }

  async upsertNotificationPreference(pref: InsertNotificationPreference): Promise<NotificationPreference> {
    const existing = await db.select().from(notificationPreferences)
      .where(sql`${notificationPreferences.userId} = ${pref.userId} AND ${notificationPreferences.eventTypeId} = ${pref.eventTypeId}`);
    if (existing.length > 0) {
      const [updated] = await db.update(notificationPreferences)
        .set({ ...pref, updatedAt: new Date() })
        .where(eq(notificationPreferences.id, existing[0].id))
        .returning();
      return updated;
    }
    const [created] = await db.insert(notificationPreferences).values(pref).returning();
    return created;
  }

  // User Settings
  async getUserSettings(userId: string): Promise<UserSettings | null> {
    const [result] = await dbRead.select().from(userSettings).where(eq(userSettings.userId, userId));
    return result || null;
  }

  async upsertUserSettings(userId: string, settings: Partial<InsertUserSettings>): Promise<UserSettings> {
    const defaultFeatureFlags = {
      memoryEnabled: false,
      recordingHistoryEnabled: false,
      webSearchAuto: true,
      codeInterpreterEnabled: true,
      canvasEnabled: true,
      voiceEnabled: true,
      voiceAdvanced: false,
      connectorSearchAuto: false
    };

    const defaultResponsePreferences = {
      responseStyle: 'default' as const,
      responseTone: 'professional',
      customInstructions: ''
    };

    const defaultUserProfile = {
      nickname: '',
      occupation: '',
      bio: '',
      showName: true,
      linkedInUrl: '',
      githubUrl: '',
      websiteDomain: '',
      receiveEmailComments: false,
    };

    const defaultPrivacySettings = {
      trainingOptIn: false,
      remoteBrowserDataAccess: false,
      analyticsTracking: true,
      chatHistoryEnabled: true,
    };

    const existing = await this.getUserSettings(userId);

    if (existing) {
      const mergedSettings = {
        responsePreferences: settings.responsePreferences
          ? { ...existing.responsePreferences, ...settings.responsePreferences }
          : existing.responsePreferences,
        userProfile: settings.userProfile
          ? { ...existing.userProfile, ...settings.userProfile }
          : existing.userProfile,
        featureFlags: settings.featureFlags
          ? { ...existing.featureFlags, ...settings.featureFlags }
          : existing.featureFlags,
        privacySettings: settings.privacySettings
          ? { ...existing.privacySettings, ...settings.privacySettings }
          : existing.privacySettings,
        updatedAt: new Date()
      };

      const [updated] = await db.update(userSettings)
        .set(mergedSettings)
        .where(eq(userSettings.userId, userId))
        .returning();
      return updated;
    }

    const newSettings: InsertUserSettings = {
      userId,
      responsePreferences: settings.responsePreferences
        ? { ...defaultResponsePreferences, ...settings.responsePreferences }
        : defaultResponsePreferences,
      userProfile: settings.userProfile
        ? { ...defaultUserProfile, ...settings.userProfile }
        : defaultUserProfile,
      featureFlags: settings.featureFlags
        ? { ...defaultFeatureFlags, ...settings.featureFlags }
        : defaultFeatureFlags,
      privacySettings: settings.privacySettings
        ? { ...defaultPrivacySettings, ...settings.privacySettings }
        : defaultPrivacySettings
    };

    const [created] = await db.insert(userSettings).values(newSettings).returning();
    return created;
  }

  // Integration Management
  async getIntegrationProviders(): Promise<IntegrationProvider[]> {
    // Use primary DB for integration catalog reads to avoid replica-lag issues (UI expects immediate consistency).
    return db.select().from(integrationProviders).orderBy(integrationProviders.name);
  }

  async getIntegrationProvider(id: string): Promise<IntegrationProvider | null> {
    const [result] = await db.select().from(integrationProviders).where(eq(integrationProviders.id, id));
    return result || null;
  }

  async createIntegrationProvider(provider: InsertIntegrationProvider): Promise<IntegrationProvider> {
    const [result] = await db.insert(integrationProviders).values(provider).returning();
    return result;
  }

  async getIntegrationAccounts(userId: string): Promise<IntegrationAccount[]> {
    return db.select().from(integrationAccounts)
      .where(eq(integrationAccounts.userId, userId))
      .orderBy(desc(integrationAccounts.createdAt));
  }

  async getIntegrationAccount(id: string): Promise<IntegrationAccount | null> {
    const [result] = await db.select().from(integrationAccounts).where(eq(integrationAccounts.id, id));
    return result || null;
  }

  async getIntegrationAccountByProvider(userId: string, providerId: string): Promise<IntegrationAccount | null> {
    const [result] = await db
      .select()
      .from(integrationAccounts)
      .where(and(eq(integrationAccounts.userId, userId), eq(integrationAccounts.providerId, providerId)))
      .orderBy(desc(integrationAccounts.createdAt))
      .limit(1);
    return result || null;
  }

  async createIntegrationAccount(account: InsertIntegrationAccount): Promise<IntegrationAccount> {
    const [result] = await db.insert(integrationAccounts).values(account).returning();
    return result;
  }

  async updateIntegrationAccount(id: string, updates: Partial<InsertIntegrationAccount>): Promise<IntegrationAccount | null> {
    const [result] = await db.update(integrationAccounts)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(integrationAccounts.id, id))
      .returning();
    return result || null;
  }

  async deleteIntegrationAccount(id: string): Promise<void> {
    await db.delete(integrationAccounts).where(eq(integrationAccounts.id, id));
  }

  async getIntegrationTools(providerId?: string): Promise<IntegrationTool[]> {
    if (providerId) {
      return db.select().from(integrationTools)
        .where(eq(integrationTools.providerId, providerId))
        .orderBy(integrationTools.name);
    }
    return db.select().from(integrationTools).orderBy(integrationTools.name);
  }

  async getIntegrationPolicy(userId: string): Promise<IntegrationPolicy | null> {
    const [result] = await db.select().from(integrationPolicies).where(eq(integrationPolicies.userId, userId));
    return result || null;
  }

  async upsertIntegrationPolicy(userId: string, policy: Partial<InsertIntegrationPolicy>): Promise<IntegrationPolicy> {
    const existing = await this.getIntegrationPolicy(userId);

    if (existing) {
      const dedupeStrings = (value: unknown): string[] => {
        if (!Array.isArray(value)) return [];
        const out: string[] = [];
        const seen = new Set<string>();
        for (const item of value) {
          if (typeof item !== "string") continue;
          const trimmed = item.trim();
          if (!trimmed) continue;
          if (seen.has(trimmed)) continue;
          seen.add(trimmed);
          out.push(trimmed);
        }
        return out;
      };

      const mergedPolicy = {
        // Patch semantics: when a field is provided, replace it (do not union).
        enabledApps: policy.enabledApps !== undefined ? dedupeStrings(policy.enabledApps) : existing.enabledApps,
        enabledTools: policy.enabledTools !== undefined ? dedupeStrings(policy.enabledTools) : existing.enabledTools,
        disabledTools: policy.disabledTools !== undefined ? dedupeStrings(policy.disabledTools) : existing.disabledTools,
        resourceScopes: policy.resourceScopes !== undefined ? policy.resourceScopes : existing.resourceScopes,
        autoConfirmPolicy: policy.autoConfirmPolicy !== undefined ? policy.autoConfirmPolicy : existing.autoConfirmPolicy,
        sandboxMode: policy.sandboxMode !== undefined ? policy.sandboxMode : existing.sandboxMode,
        maxParallelCalls: policy.maxParallelCalls !== undefined ? policy.maxParallelCalls : existing.maxParallelCalls,
        updatedAt: new Date()
      };

      const [updated] = await db.update(integrationPolicies)
        .set(mergedPolicy)
        .where(eq(integrationPolicies.userId, userId))
        .returning();
      return updated;
    }

    const newPolicy: InsertIntegrationPolicy = {
      userId,
      enabledApps: policy.enabledApps || [],
      enabledTools: policy.enabledTools || [],
      disabledTools: policy.disabledTools || [],
      resourceScopes: policy.resourceScopes,
      autoConfirmPolicy: policy.autoConfirmPolicy || 'ask',
      sandboxMode: policy.sandboxMode || 'false',
      maxParallelCalls: policy.maxParallelCalls || 3
    };

    const [created] = await db.insert(integrationPolicies).values(newPolicy).returning();
    return created;
  }

  async createToolCallLog(log: InsertToolCallLog): Promise<ToolCallLog> {
    const [result] = await db.insert(toolCallLogs).values(log).returning();
    return result;
  }

  async getToolCallLogs(userId: string, limit: number = 100): Promise<ToolCallLog[]> {
    return db.select().from(toolCallLogs)
      .where(eq(toolCallLogs.userId, userId))
      .orderBy(desc(toolCallLogs.createdAt))
      .limit(limit);
  }

  // Consent Logs
  async logConsent(userId: string, consentType: string, value: string, ipAddress?: string, userAgent?: string): Promise<void> {
    await db.insert(consentLogs).values({
      userId,
      consentType,
      value,
      ipAddress,
      userAgent,
    });
  }

  async getConsentLogs(userId: string, limit: number = 50): Promise<ConsentLog[]> {
    return dbRead.select().from(consentLogs)
      .where(eq(consentLogs.userId, userId))
      .orderBy(desc(consentLogs.createdAt))
      .limit(limit);
  }

  // Shared Links CRUD
  async createSharedLink(data: InsertSharedLink): Promise<SharedLink> {
    const token = data.token || crypto.randomBytes(32).toString('hex');
    const [result] = await db.insert(sharedLinks).values({ ...data, token }).returning();
    return result;
  }

  async getSharedLinks(userId: string): Promise<SharedLink[]> {
    return dbRead.select().from(sharedLinks)
      .where(eq(sharedLinks.userId, userId))
      .orderBy(desc(sharedLinks.createdAt));
  }

  async getSharedLinkByToken(token: string): Promise<SharedLink | undefined> {
    const [result] = await dbRead.select().from(sharedLinks).where(eq(sharedLinks.token, token));
    return result;
  }

  async updateSharedLink(id: string, data: Partial<InsertSharedLink>): Promise<SharedLink> {
    const [result] = await db.update(sharedLinks)
      .set(data)
      .where(eq(sharedLinks.id, id))
      .returning();
    return result;
  }

  async revokeSharedLink(id: string): Promise<void> {
    await db.update(sharedLinks)
      .set({ isRevoked: 'true' })
      .where(eq(sharedLinks.id, id));
  }

  async rotateSharedLinkToken(id: string): Promise<SharedLink> {
    const newToken = crypto.randomBytes(32).toString('hex');
    const [result] = await db.update(sharedLinks)
      .set({ token: newToken })
      .where(eq(sharedLinks.id, id))
      .returning();
    return result;
  }

  async incrementSharedLinkAccess(id: string): Promise<void> {
    await db.update(sharedLinks)
      .set({
        accessCount: sql`${sharedLinks.accessCount} + 1`,
        lastAccessedAt: new Date()
      })
      .where(eq(sharedLinks.id, id));
  }

  // Archived/Deleted Chats
  async getArchivedChats(userId: string): Promise<Chat[]> {
    return dbRead.select().from(chats)
      .where(and(eq(chats.userId, userId), eq(chats.archived, 'true'), isNull(chats.deletedAt)))
      .orderBy(desc(chats.updatedAt));
  }

  async unarchiveChat(chatId: string): Promise<void> {
    await db.update(chats)
      .set({ archived: 'false', updatedAt: new Date() })
      .where(eq(chats.id, chatId));
  }

  async archiveAllChats(userId: string): Promise<number> {
    const result = await db.update(chats)
      .set({ archived: 'true', updatedAt: new Date() })
      .where(and(eq(chats.userId, userId), eq(chats.archived, 'false'), isNull(chats.deletedAt)))
      .returning();
    return result.length;
  }

  async softDeleteChat(chatId: string): Promise<void> {
    await db.update(chats)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(chats.id, chatId));
  }

  async softDeleteAllChats(userId: string): Promise<number> {
    const result = await db.update(chats)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(chats.userId, userId), isNull(chats.deletedAt)))
      .returning();
    return result.length;
  }

  async getDeletedChats(userId: string): Promise<Chat[]> {
    return dbRead.select().from(chats)
      .where(and(eq(chats.userId, userId), sql`${chats.deletedAt} IS NOT NULL`))
      .orderBy(desc(chats.deletedAt));
  }

  async restoreDeletedChat(chatId: string): Promise<void> {
    await db.update(chats)
      .set({ deletedAt: null, updatedAt: new Date() })
      .where(eq(chats.id, chatId));
  }

  async permanentlyDeleteChat(chatId: string): Promise<void> {
    await db.delete(chats).where(eq(chats.id, chatId));
  }

  // Company Knowledge
  async getCompanyKnowledge(userId: string): Promise<CompanyKnowledge[]> {
    return dbRead.select().from(companyKnowledge)
      .where(eq(companyKnowledge.userId, userId))
      .orderBy(desc(companyKnowledge.createdAt));
  }

  async getActiveCompanyKnowledge(userId: string): Promise<CompanyKnowledge[]> {
    // companyKnowledge schema doesn't include an isActive flag; treat all entries as active.
    return dbRead.select().from(companyKnowledge)
      .where(eq(companyKnowledge.userId, userId))
      .orderBy(desc(companyKnowledge.createdAt));
  }

  async createCompanyKnowledge(knowledge: InsertCompanyKnowledge): Promise<CompanyKnowledge> {
    const [result] = await db.insert(companyKnowledge).values(knowledge).returning();
    return result;
  }

  async updateCompanyKnowledge(id: string, updates: Partial<InsertCompanyKnowledge>): Promise<CompanyKnowledge | null> {
    const [result] = await db.update(companyKnowledge)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(companyKnowledge.id, id))
      .returning();
    return result || null;
  }

  async deleteCompanyKnowledge(id: string): Promise<void> {
    await db.delete(companyKnowledge).where(eq(companyKnowledge.id, id));
  }

  // Gmail OAuth Token operations (Custom MCP)
  async getGmailOAuthToken(userId: string): Promise<GmailOAuthToken | null> {
    const [token] = await dbRead.select().from(gmailOAuthTokens)
      .where(eq(gmailOAuthTokens.userId, userId));
    return token || null;
  }

  async saveGmailOAuthToken(token: InsertGmailOAuthToken): Promise<GmailOAuthToken> {
    const existing = await this.getGmailOAuthToken(token.userId);
    if (existing) {
      const [updated] = await db.update(gmailOAuthTokens)
        .set({ ...token, updatedAt: new Date() })
        .where(eq(gmailOAuthTokens.userId, token.userId))
        .returning();
      return updated;
    }
    const [result] = await db.insert(gmailOAuthTokens).values(token).returning();
    return result;
  }

  async updateGmailOAuthToken(userId: string, updates: Partial<InsertGmailOAuthToken>): Promise<GmailOAuthToken | null> {
    const [result] = await db.update(gmailOAuthTokens)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(gmailOAuthTokens.userId, userId))
      .returning();
    return result || null;
  }

  async deleteGmailOAuthToken(userId: string): Promise<void> {
    await db.delete(gmailOAuthTokens).where(eq(gmailOAuthTokens.userId, userId));
  }

  // Message Idempotency operations
  async findMessageByRequestId(requestId: string): Promise<ChatMessage | null> {
    const [fromRead] = await dbRead.select().from(chatMessages)
      .where(eq(chatMessages.requestId, requestId));
    if (fromRead) return fromRead;

    // Fallback to primary DB for strong reads (avoid replica lag in idempotency flows).
    const [fromPrimary] = await db.select().from(chatMessages)
      .where(eq(chatMessages.requestId, requestId));
    return fromPrimary || null;
  }

  async claimPendingMessage(messageId: string): Promise<ChatMessage | null> {
    const [result] = await db.update(chatMessages)
      .set({ status: 'processing' })
      .where(and(
        eq(chatMessages.id, messageId),
        eq(chatMessages.status, 'pending')
      ))
      .returning();
    return result || null;
  }

  async updateMessageStatus(messageId: string, status: 'pending' | 'processing' | 'done' | 'failed'): Promise<ChatMessage | null> {
    const [result] = await db.update(chatMessages)
      .set({ status })
      .where(eq(chatMessages.id, messageId))
      .returning();
    return result || null;
  }

  async updateMessageContent(messageId: string, content: string, additionalData?: Partial<InsertChatMessage>): Promise<ChatMessage | null> {
    const [result] = await db.update(chatMessages)
      .set({ content, ...additionalData })
      .where(eq(chatMessages.id, messageId))
      .returning();
    return result || null;
  }

  async findAssistantResponseForUserMessage(userMessageId: string): Promise<ChatMessage | null> {
    const [fromRead] = await dbRead.select().from(chatMessages)
      .where(and(
        eq(chatMessages.userMessageId, userMessageId),
        eq(chatMessages.role, 'assistant')
      ));
    if (fromRead) return fromRead;

    const [fromPrimary] = await db.select().from(chatMessages)
      .where(and(
        eq(chatMessages.userMessageId, userMessageId),
        eq(chatMessages.role, 'assistant')
      ));
    return fromPrimary || null;
  }

  // Response Quality Metrics
  async recordQualityMetric(metric: InsertResponseQualityMetric): Promise<ResponseQualityMetric> {
    const [result] = await db.insert(responseQualityMetrics).values(metric).returning();
    return result;
  }

  async getQualityMetrics(since: Date, limit: number = 100): Promise<ResponseQualityMetric[]> {
    return dbRead.select().from(responseQualityMetrics)
      .where(sql`${responseQualityMetrics.createdAt} >= ${since}`)
      .orderBy(desc(responseQualityMetrics.createdAt))
      .limit(limit);
  }

  // Connector Usage Hourly
  async upsertConnectorUsage(connector: string, hourBucket: Date, success: boolean, latencyMs: number): Promise<ConnectorUsageHourly> {
    const roundedHour = new Date(hourBucket);
    roundedHour.setMinutes(0, 0, 0);

    const existing = await db.select().from(connectorUsageHourly)
      .where(and(
        eq(connectorUsageHourly.connector, connector),
        eq(connectorUsageHourly.hourBucket, roundedHour)
      ));

    if (existing.length > 0) {
      const current = existing[0];
      const [updated] = await db.update(connectorUsageHourly)
        .set({
          totalCalls: (current.totalCalls || 0) + 1,
          successCount: success ? (current.successCount || 0) + 1 : current.successCount,
          failureCount: !success ? (current.failureCount || 0) + 1 : current.failureCount,
          totalLatencyMs: (current.totalLatencyMs || 0) + latencyMs,
        })
        .where(eq(connectorUsageHourly.id, current.id))
        .returning();
      return updated;
    }

    const [created] = await db.insert(connectorUsageHourly).values({
      connector,
      hourBucket: roundedHour,
      totalCalls: 1,
      successCount: success ? 1 : 0,
      failureCount: !success ? 1 : 0,
      totalLatencyMs: latencyMs,
    }).returning();
    return created;
  }

  async getConnectorUsageStats(connector: string, since: Date): Promise<ConnectorUsageHourly[]> {
    return dbRead.select().from(connectorUsageHourly)
      .where(and(
        eq(connectorUsageHourly.connector, connector),
        sql`${connectorUsageHourly.createdAt} >= ${since}`
      ))
      .orderBy(desc(connectorUsageHourly.hourBucket));
  }

  // Offline Message Queue
  async createOfflineMessage(message: InsertOfflineMessageQueue): Promise<OfflineMessageQueue> {
    const [result] = await db.insert(offlineMessageQueue).values(message).returning();
    return result;
  }

  async getOfflineMessages(userId: string, status?: string): Promise<OfflineMessageQueue[]> {
    if (status) {
      return dbRead.select().from(offlineMessageQueue)
        .where(and(
          eq(offlineMessageQueue.userId, userId),
          eq(offlineMessageQueue.status, status)
        ))
        .orderBy(offlineMessageQueue.createdAt);
    }
    return dbRead.select().from(offlineMessageQueue)
      .where(eq(offlineMessageQueue.userId, userId))
      .orderBy(offlineMessageQueue.createdAt);
  }

  async updateOfflineMessageStatus(id: string, status: string, error?: string): Promise<OfflineMessageQueue | null> {
    const updates: any = { status };
    if (error) {
      // offlineMessageQueue schema doesn't have an `error` column; keep only retryCount.
      updates.retryCount = (sql<number>`${offlineMessageQueue.retryCount} + 1` as any);
    }
    const [result] = await db.update(offlineMessageQueue)
      .set(updates)
      .where(eq(offlineMessageQueue.id, id))
      .returning();
    return result || null;
  }

  async syncOfflineMessage(id: string): Promise<OfflineMessageQueue | null> {
    const [result] = await db.update(offlineMessageQueue)
      .set({ status: 'synced', processedAt: new Date() })
      .where(eq(offlineMessageQueue.id, id))
      .returning();
    return result || null;
  }

  // Chat Stats
  async updateChatMessageStats(chatId: string): Promise<Chat | undefined> {
    const messages = await db.select().from(chatMessages)
      .where(eq(chatMessages.chatId, chatId))
      .orderBy(desc(chatMessages.createdAt));

    const messageCount = messages.length;
    const lastMessageAt = messages.length > 0 ? messages[0].createdAt : null;

    const [result] = await db.update(chats)
      .set({
        messageCount,
        lastMessageAt,
        updatedAt: new Date()
      })
      .where(eq(chats.id, chatId))
      .returning();
    return result;
  }

  // Provider Metrics
  async createProviderMetrics(metrics: InsertProviderMetrics): Promise<ProviderMetrics> {
    const [result] = await db.insert(providerMetrics).values(metrics).returning();
    return result;
  }

  async getProviderMetrics(provider?: string, startDate?: Date, endDate?: Date): Promise<ProviderMetrics[]> {
    let query = dbRead.select().from(providerMetrics);
    const conditions: any[] = [];

    if (provider) {
      conditions.push(eq(providerMetrics.provider, provider));
    }
    if (startDate) {
      conditions.push(sql`${providerMetrics.windowStart} >= ${startDate}`);
    }
    if (endDate) {
      conditions.push(sql`${providerMetrics.windowEnd} <= ${endDate}`);
    }

    if (conditions.length > 0) {
      return dbRead.select().from(providerMetrics)
        .where(and(...conditions))
        .orderBy(desc(providerMetrics.windowStart));
    }
    return dbRead.select().from(providerMetrics).orderBy(desc(providerMetrics.windowStart));
  }

  async getLatestProviderMetrics(): Promise<ProviderMetrics[]> {
    const result = await dbRead.execute(sql`
      SELECT DISTINCT ON (provider) *
      FROM provider_metrics
      ORDER BY provider, window_start DESC
    `);
    return result.rows as ProviderMetrics[];
  }

  // Cost Budgets
  async getCostBudgets(): Promise<CostBudget[]> {
    return dbRead.select().from(costBudgets).orderBy(costBudgets.provider);
  }

  async getCostBudget(provider: string): Promise<CostBudget | undefined> {
    const [result] = await dbRead.select().from(costBudgets).where(eq(costBudgets.provider, provider));
    return result;
  }

  async upsertCostBudget(budget: InsertCostBudget): Promise<CostBudget> {
    const existing = await this.getCostBudget(budget.provider);
    if (existing) {
      const [updated] = await db.update(costBudgets)
        .set({ ...budget, updatedAt: new Date() })
        .where(eq(costBudgets.provider, budget.provider))
        .returning();
      return updated;
    }
    const [created] = await db.insert(costBudgets).values(budget).returning();
    return created;
  }

  // API Logs
  async createApiLog(log: InsertApiLog): Promise<ApiLog> {
    const [result] = await db.insert(apiLogs).values(log).returning();
    return result;
  }

  async getApiLogs(filters: { page?: number; limit?: number; provider?: string; statusCode?: number; startDate?: Date; endDate?: Date }): Promise<{ logs: ApiLog[]; total: number }> {
    const { page = 1, limit = 50, provider, statusCode, startDate, endDate } = filters;
    const offset = (page - 1) * limit;
    const conditions: any[] = [];

    if (provider) {
      conditions.push(eq(apiLogs.provider, provider));
    }
    if (statusCode) {
      conditions.push(eq(apiLogs.statusCode, statusCode));
    }
    if (startDate) {
      conditions.push(sql`${apiLogs.createdAt} >= ${startDate}`);
    }
    if (endDate) {
      conditions.push(sql`${apiLogs.createdAt} <= ${endDate}`);
    }

    let logs: ApiLog[];
    let countResult: any;

    if (conditions.length > 0) {
      logs = await dbRead.select().from(apiLogs)
        .where(and(...conditions))
        .orderBy(desc(apiLogs.createdAt))
        .limit(limit)
        .offset(offset);
      countResult = await dbRead.select({ count: sql<number>`count(*)` }).from(apiLogs).where(and(...conditions));
    } else {
      logs = await dbRead.select().from(apiLogs)
        .orderBy(desc(apiLogs.createdAt))
        .limit(limit)
        .offset(offset);
      countResult = await dbRead.select({ count: sql<number>`count(*)` }).from(apiLogs);
    }

    return { logs, total: Number(countResult[0]?.count || 0) };
  }

  async getApiLogStats(): Promise<{ byStatusCode: Record<number, number>; byProvider: Record<string, number> }> {
    const statusCodeStats = await dbRead.execute(sql`
      SELECT status_code, COUNT(*) as count
      FROM api_logs
      WHERE status_code IS NOT NULL
      GROUP BY status_code
    `);

    const providerStats = await dbRead.execute(sql`
      SELECT provider, COUNT(*) as count
      FROM api_logs
      WHERE provider IS NOT NULL
      GROUP BY provider
    `);

    const byStatusCode: Record<number, number> = {};
    for (const row of statusCodeStats.rows as { status_code: number; count: number | string }[]) {
      byStatusCode[row.status_code] = Number(row.count);
    }

    const byProvider: Record<string, number> = {};
    for (const row of providerStats.rows as { provider: string; count: number | string }[]) {
      byProvider[row.provider] = Number(row.count);
    }

    return { byStatusCode, byProvider };
  }

  // KPI Snapshots
  async createKpiSnapshot(snapshot: InsertKpiSnapshot): Promise<KpiSnapshot> {
    const [result] = await db.insert(kpiSnapshots).values(snapshot).returning();
    return result;
  }

  async getLatestKpiSnapshot(): Promise<KpiSnapshot | undefined> {
    const [result] = await dbRead.select().from(kpiSnapshots)
      .orderBy(desc(kpiSnapshots.createdAt))
      .limit(1);
    return result;
  }

  async getKpiSnapshots(limit: number = 100): Promise<KpiSnapshot[]> {
    return dbRead.select().from(kpiSnapshots)
      .orderBy(desc(kpiSnapshots.createdAt))
      .limit(limit);
  }

  // Analytics Events (extended)
  async createAnalyticsEvent(event: InsertAnalyticsEvent): Promise<AnalyticsEvent> {
    const [result] = await db.insert(analyticsEvents).values(event).returning();
    return result;
  }

  async getAnalyticsEventStats(startDate?: Date, endDate?: Date): Promise<Record<string, number>> {
    let query;
    const conditions: any[] = [];

    if (startDate) {
      conditions.push(sql`${analyticsEvents.createdAt} >= ${startDate}`);
    }
    if (endDate) {
      conditions.push(sql`${analyticsEvents.createdAt} <= ${endDate}`);
    }

    if (conditions.length > 0) {
      query = await dbRead.execute(sql`
        SELECT event_name, COUNT(*) as count
        FROM analytics_events
        WHERE ${sql.join(conditions, sql` AND `)}
        GROUP BY event_name
        ORDER BY count DESC
      `);
    } else {
      query = await dbRead.execute(sql`
        SELECT event_name, COUNT(*) as count
        FROM analytics_events
        GROUP BY event_name
        ORDER BY count DESC
      `);
    }

    const stats: Record<string, number> = {};
    for (const row of query.rows as { event_name: string; count: number | string }[]) {
      stats[row.event_name] = Number(row.count);
    }
    return stats;
  }

  async getUserGrowthData(granularity: '1h' | '24h' | '7d' | '30d' | '90d' | '1y'): Promise<{ date: Date; count: number }[]> {
    const configMap: Record<string, { interval: string; trunc: string }> = {
      '1h': { interval: '1 hour', trunc: 'hour' },
      '24h': { interval: '1 day', trunc: 'hour' },
      '7d': { interval: '7 days', trunc: 'day' },
      '30d': { interval: '30 days', trunc: 'day' },
      '90d': { interval: '90 days', trunc: 'week' },
      '1y': { interval: '1 year', trunc: 'month' },
    };

    const config = configMap[granularity];

    const result = await dbRead.execute(sql`
      SELECT date_trunc(${config.trunc}, created_at) as date, COUNT(*) as count
      FROM users
      WHERE created_at >= NOW() - INTERVAL ${config.interval}
      GROUP BY date_trunc(${config.trunc}, created_at)
      ORDER BY date ASC
    `);

    return (result.rows as { date: string | Date; count: number | string }[]).map(row => ({
      date: new Date(row.date),
      count: Number(row.count),
    }));
  }

  // Security Policies CRUD
  async getSecurityPolicies(): Promise<SecurityPolicy[]> {
    return dbRead.select().from(securityPolicies).orderBy(desc(securityPolicies.priority));
  }

  async getSecurityPolicy(id: string): Promise<SecurityPolicy | undefined> {
    const [result] = await dbRead.select().from(securityPolicies).where(eq(securityPolicies.id, id));
    return result;
  }

  async createSecurityPolicy(policy: InsertSecurityPolicy): Promise<SecurityPolicy> {
    const [result] = await db.insert(securityPolicies).values(policy).returning();
    return result;
  }

  async updateSecurityPolicy(id: string, updates: Partial<InsertSecurityPolicy>): Promise<SecurityPolicy | undefined> {
    const [result] = await db.update(securityPolicies)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(securityPolicies.id, id))
      .returning();
    return result;
  }

  async deleteSecurityPolicy(id: string): Promise<void> {
    await db.delete(securityPolicies).where(eq(securityPolicies.id, id));
  }

  async toggleSecurityPolicy(id: string, isEnabled: boolean): Promise<SecurityPolicy | undefined> {
    const [result] = await db.update(securityPolicies)
      .set({ isEnabled: isEnabled ? "true" : "false", updatedAt: new Date() })
      .where(eq(securityPolicies.id, id))
      .returning();
    return result;
  }

  // Report Templates CRUD
  async getReportTemplates(): Promise<ReportTemplate[]> {
    return dbRead.select().from(reportTemplates).orderBy(desc(reportTemplates.createdAt));
  }

  async getReportTemplate(id: string): Promise<ReportTemplate | undefined> {
    const [result] = await dbRead.select().from(reportTemplates).where(eq(reportTemplates.id, id));
    return result;
  }

  async createReportTemplate(template: InsertReportTemplate): Promise<ReportTemplate> {
    const [result] = await db.insert(reportTemplates).values(template).returning();
    return result;
  }

  // Generated Reports CRUD
  async getGeneratedReports(limit: number = 100): Promise<GeneratedReport[]> {
    return dbRead.select().from(generatedReports)
      .orderBy(desc(generatedReports.createdAt))
      .limit(limit);
  }

  async getGeneratedReport(id: string): Promise<GeneratedReport | undefined> {
    const [result] = await dbRead.select().from(generatedReports).where(eq(generatedReports.id, id));
    return result;
  }

  async createGeneratedReport(report: InsertGeneratedReport): Promise<GeneratedReport> {
    const [result] = await db.insert(generatedReports).values(report).returning();
    return result;
  }

  async updateGeneratedReport(id: string, updates: Partial<InsertGeneratedReport>): Promise<GeneratedReport | undefined> {
    const [result] = await db.update(generatedReports)
      .set(updates)
      .where(eq(generatedReports.id, id))
      .returning();
    return result;
  }

  async deleteGeneratedReport(id: string): Promise<void> {
    await db.delete(generatedReports).where(eq(generatedReports.id, id));
  }

  // Settings Config CRUD
  async getSettingsConfig(): Promise<SettingsConfig[]> {
    return dbRead.select().from(settingsConfig).orderBy(settingsConfig.category, settingsConfig.key);
  }

  async getSettingsConfigByCategory(category: string): Promise<SettingsConfig[]> {
    return dbRead.select().from(settingsConfig).where(eq(settingsConfig.category, category)).orderBy(settingsConfig.key);
  }

  async getSettingsConfigByKey(key: string): Promise<SettingsConfig | undefined> {
    const [result] = await dbRead.select().from(settingsConfig).where(eq(settingsConfig.key, key));
    return result;
  }

  async upsertSettingsConfig(setting: InsertSettingsConfig): Promise<SettingsConfig> {
    const existing = await this.getSettingsConfigByKey(setting.key);
    if (existing) {
      const [result] = await db.update(settingsConfig)
        .set({ ...setting, updatedAt: new Date() })
        .where(eq(settingsConfig.key, setting.key))
        .returning();
      return result;
    }
    const [result] = await db.insert(settingsConfig).values(setting).returning();
    return result;
  }

  async deleteSettingsConfig(key: string): Promise<void> {
    await db.delete(settingsConfig).where(eq(settingsConfig.key, key));
  }

  async seedDefaultSettings(): Promise<void> {
    const defaultSettings: InsertSettingsConfig[] = [
      { category: "general", key: "app_name", value: "iliagpt", defaultValue: "iliagpt", valueType: "string", description: "Application name" },
      { category: "general", key: "app_description", value: "AI Platform", defaultValue: "AI Platform", valueType: "string", description: "Application description" },
      { category: "general", key: "support_email", value: "", defaultValue: "", valueType: "string", description: "Support email address" },
      { category: "general", key: "timezone_default", value: "UTC", defaultValue: "UTC", valueType: "string", description: "Default timezone" },
      { category: "general", key: "date_format", value: "YYYY-MM-DD", defaultValue: "YYYY-MM-DD", valueType: "string", description: "Date format" },
      { category: "general", key: "maintenance_mode", value: false, defaultValue: false, valueType: "boolean", description: "Enable maintenance mode" },
      { category: "branding", key: "primary_color", value: "#6366f1", defaultValue: "#6366f1", valueType: "string", description: "Primary brand color" },
      { category: "branding", key: "secondary_color", value: "#8b5cf6", defaultValue: "#8b5cf6", valueType: "string", description: "Secondary brand color" },
      { category: "branding", key: "theme_mode", value: "auto", defaultValue: "auto", valueType: "string", description: "Default theme mode" },
      { category: "users", key: "allow_registration", value: true, defaultValue: true, valueType: "boolean", description: "Allow user registration" },
      { category: "users", key: "require_email_verification", value: false, defaultValue: false, valueType: "boolean", description: "Require email verification" },
      { category: "users", key: "session_timeout_minutes", value: 1440, defaultValue: 1440, valueType: "number", description: "Session timeout in minutes" },
      { category: "ai_models", key: "default_model", value: "grok-4-1-fast-non-reasoning", defaultValue: "grok-4-1-fast-non-reasoning", valueType: "string", description: "Default AI model" },
      { category: "ai_models", key: "max_tokens_per_request", value: 4096, defaultValue: 4096, valueType: "number", description: "Max tokens per request" },
      { category: "ai_models", key: "enable_streaming", value: true, defaultValue: true, valueType: "boolean", description: "Enable streaming responses" },
      { category: "security", key: "max_login_attempts", value: 5, defaultValue: 5, valueType: "number", description: "Max login attempts before lockout" },
      { category: "security", key: "lockout_duration_minutes", value: 30, defaultValue: 30, valueType: "number", description: "Lockout duration in minutes" },
      { category: "security", key: "require_2fa_admins", value: false, defaultValue: false, valueType: "boolean", description: "Require 2FA for admins" },
      { category: "notifications", key: "email_notifications_enabled", value: true, defaultValue: true, valueType: "boolean", description: "Enable email notifications" },
      { category: "notifications", key: "slack_webhook_url", value: "", defaultValue: "", valueType: "string", description: "Slack webhook URL", isSensitive: "true" },
    ];

    for (const setting of defaultSettings) {
      await db.insert(settingsConfig).values(setting).onConflictDoNothing();
    }
  }

  // Agent Gap Logs CRUD
  private generateGapSignature(userId: string | null | undefined, prompt: string, intent: string | null): string {
    // Include userId so frequency aggregation doesn't merge across different accounts.
    const normalized = ((userId || 'unknown') + '|' + prompt.toLowerCase().trim() + '|' + (intent || 'unknown')).substring(0, 240);
    let hash = 0;
    for (let i = 0; i < normalized.length; i++) {
      const char = normalized.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return 'gap_' + Math.abs(hash).toString(16);
  }

  async createAgentGapLog(log: InsertAgentGapLog): Promise<AgentGapLog> {
    const signature = this.generateGapSignature(log.userId || null, log.userPrompt, log.detectedIntent || null);

    const existing = await db.select()
      .from(agentGapLogs)
      .where(
        and(
          eq(agentGapLogs.gapSignature, signature),
          eq(agentGapLogs.status, 'pending'),
          log.userId ? eq(agentGapLogs.userId, log.userId) : isNull(agentGapLogs.userId)
        )
      )
      .limit(1);

    if (existing.length > 0) {
      const updated = await db.update(agentGapLogs)
        .set({
          frequencyCount: sql`${agentGapLogs.frequencyCount} + 1`,
          updatedAt: new Date()
        })
        .where(eq(agentGapLogs.id, existing[0].id))
        .returning();
      return updated[0];
    }

    const [result] = await db.insert(agentGapLogs)
      .values({ ...log, gapSignature: signature, frequencyCount: 1 })
      .returning();
    return result;
  }

  async getAgentGapLogs(status?: string, userId?: string): Promise<AgentGapLog[]> {
    if (status && userId) {
      return dbRead.select().from(agentGapLogs)
        .where(and(eq(agentGapLogs.status, status), eq(agentGapLogs.userId, userId)))
        .orderBy(desc(agentGapLogs.createdAt));
    }
    if (status) {
      return dbRead.select().from(agentGapLogs)
        .where(eq(agentGapLogs.status, status))
        .orderBy(desc(agentGapLogs.createdAt));
    }
    if (userId) {
      return dbRead.select().from(agentGapLogs)
        .where(eq(agentGapLogs.userId, userId))
        .orderBy(desc(agentGapLogs.createdAt));
    }
    return dbRead.select().from(agentGapLogs).orderBy(desc(agentGapLogs.createdAt));
  }

  async updateAgentGapLog(id: string, updates: Partial<InsertAgentGapLog>): Promise<AgentGapLog | undefined> {
    const [result] = await db.update(agentGapLogs)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(agentGapLogs.id, id))
      .returning();
    return result;
  }

  // Library Folder CRUD
  async getLibraryFolders(userId: string): Promise<LibraryFolder[]> {
    return dbRead.select().from(libraryFolders)
      .where(eq(libraryFolders.userId, userId))
      .orderBy(libraryFolders.name);
  }

  async getLibraryFolder(id: string, userId: string): Promise<LibraryFolder | null> {
    const [result] = await dbRead.select().from(libraryFolders)
      .where(and(eq(libraryFolders.uuid, id), eq(libraryFolders.userId, userId)));
    return result || null;
  }

  async createLibraryFolder(folder: InsertLibraryFolder): Promise<LibraryFolder> {
    const [result] = await db.insert(libraryFolders).values(folder).returning();
    return result;
  }

  async updateLibraryFolder(id: string, userId: string, updates: Partial<InsertLibraryFolder>): Promise<LibraryFolder | null> {
    const [result] = await db.update(libraryFolders)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(eq(libraryFolders.uuid, id), eq(libraryFolders.userId, userId)))
      .returning();
    return result || null;
  }

  async deleteLibraryFolder(id: string, userId: string): Promise<boolean> {
    const result = await db.delete(libraryFolders)
      .where(and(eq(libraryFolders.uuid, id), eq(libraryFolders.userId, userId)));
    return (result.rowCount ?? 0) > 0;
  }

  // Library Collection CRUD
  async getLibraryCollections(userId: string): Promise<LibraryCollection[]> {
    return dbRead.select().from(libraryCollections)
      .where(eq(libraryCollections.userId, userId))
      .orderBy(desc(libraryCollections.createdAt));
  }

  async getLibraryCollection(id: string, userId: string): Promise<LibraryCollection | null> {
    const [result] = await dbRead.select().from(libraryCollections)
      .where(and(eq(libraryCollections.uuid, id), eq(libraryCollections.userId, userId)));
    return result || null;
  }

  async createLibraryCollection(collection: InsertLibraryCollection): Promise<LibraryCollection> {
    const [result] = await db.insert(libraryCollections).values(collection).returning();
    return result;
  }

  async updateLibraryCollection(id: string, userId: string, updates: Partial<InsertLibraryCollection>): Promise<LibraryCollection | null> {
    const [result] = await db.update(libraryCollections)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(eq(libraryCollections.uuid, id), eq(libraryCollections.userId, userId)))
      .returning();
    return result || null;
  }

  async deleteLibraryCollection(id: string, userId: string): Promise<boolean> {
    const collection = await this.getLibraryCollection(id, userId);
    if (!collection) return false;
    await db.delete(libraryFileCollections).where(eq(libraryFileCollections.collectionId, collection.id));
    const result = await db.delete(libraryCollections)
      .where(and(eq(libraryCollections.uuid, id), eq(libraryCollections.userId, userId)));
    return (result.rowCount ?? 0) > 0;
  }

  // Library File-Collection Relationship
  async addFileToCollection(fileId: string, collectionId: string): Promise<void> {
    const [file] = await db.select().from(libraryFiles).where(eq(libraryFiles.uuid, fileId));
    const [collection] = await db.select().from(libraryCollections).where(eq(libraryCollections.uuid, collectionId));
    if (file && collection) {
      await db.insert(libraryFileCollections)
        .values({ fileId: file.id, collectionId: collection.id })
        .onConflictDoNothing();
    }
  }

  async removeFileFromCollection(fileId: string, collectionId: string): Promise<boolean> {
    const [file] = await db.select().from(libraryFiles).where(eq(libraryFiles.uuid, fileId));
    const [collection] = await db.select().from(libraryCollections).where(eq(libraryCollections.uuid, collectionId));
    if (!file || !collection) return false;
    const result = await db.delete(libraryFileCollections)
      .where(and(eq(libraryFileCollections.fileId, file.id), eq(libraryFileCollections.collectionId, collection.id)));
    return (result.rowCount ?? 0) > 0;
  }

  async getCollectionFiles(collectionId: string, userId: string): Promise<LibraryFile[]> {
    const [collection] = await dbRead.select().from(libraryCollections)
      .where(and(eq(libraryCollections.uuid, collectionId), eq(libraryCollections.userId, userId)));
    if (!collection) return [];
    const fileLinks = await dbRead.select().from(libraryFileCollections)
      .where(eq(libraryFileCollections.collectionId, collection.id))
      .orderBy(libraryFileCollections.order);
    if (fileLinks.length === 0) return [];
    const fileIds = fileLinks.map(fl => fl.fileId);
    return dbRead.select().from(libraryFiles)
      .where(sql`${libraryFiles.id} IN (${sql.join(fileIds.map(id => sql`${id}`), sql`, `)})`);
  }

  // Enhanced Library File CRUD
  async getLibraryFile(id: string, userId: string): Promise<LibraryFile | null> {
    const [result] = await dbRead.select().from(libraryFiles)
      .where(and(eq(libraryFiles.uuid, id), eq(libraryFiles.userId, userId)));
    return result || null;
  }

  async getLibraryFiles(userId: string, options?: { type?: string; folderId?: string; search?: string }): Promise<LibraryFile[]> {
    const conditions = [eq(libraryFiles.userId, userId), isNull(libraryFiles.deletedAt)];
    if (options?.type) {
      conditions.push(eq(libraryFiles.type, options.type));
    }
    if (options?.folderId) {
      const [folder] = await dbRead.select().from(libraryFolders)
        .where(and(eq(libraryFolders.uuid, options.folderId), eq(libraryFolders.userId, userId)));
      if (folder) {
        conditions.push(eq(libraryFiles.folderId, folder.id));
      }
    }
    if (options?.search) {
      conditions.push(
        or(
          ilike(libraryFiles.name, `%${options.search}%`),
          ilike(libraryFiles.originalName, `%${options.search}%`),
          ilike(libraryFiles.description, `%${options.search}%`)
        ) as SQL
      );
    }
    return dbRead.select().from(libraryFiles)
      .where(and(...conditions))
      .orderBy(desc(libraryFiles.createdAt));
  }

  async createLibraryFile(file: InsertLibraryFile): Promise<LibraryFile> {
    const [result] = await db.insert(libraryFiles).values(file).returning();
    return result;
  }

  async updateLibraryFile(id: string, userId: string, updates: Partial<InsertLibraryFile>): Promise<LibraryFile | null> {
    const [result] = await db.update(libraryFiles)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(eq(libraryFiles.uuid, id), eq(libraryFiles.userId, userId)))
      .returning();
    return result || null;
  }

  async deleteLibraryFile(id: string, userId: string): Promise<boolean> {
    const [result] = await db.update(libraryFiles)
      .set({ deletedAt: new Date() })
      .where(and(eq(libraryFiles.uuid, id), eq(libraryFiles.userId, userId)))
      .returning();
    return !!result;
  }

  // Library Storage Stats
  async getLibraryStorageStats(userId: string): Promise<LibraryStorageStats | null> {
    const [result] = await dbRead.select().from(libraryStorage).where(eq(libraryStorage.userId, userId));
    return result || null;
  }

  async upsertLibraryStorageStats(userId: string, stats: Partial<LibraryStorageStats>): Promise<LibraryStorageStats> {
    const existing = await this.getLibraryStorageStats(userId);
    if (existing) {
      const [result] = await db.update(libraryStorage)
        .set({ ...stats, updatedAt: new Date() })
        .where(eq(libraryStorage.userId, userId))
        .returning();
      return result;
    }
    const [result] = await db.insert(libraryStorage)
      .values({ userId, ...stats })
      .returning();
    return result;
  }

  // Library Activity
  async logLibraryActivity(activity: { userId: string; fileId?: number; folderId?: number; collectionId?: number; activityType: string; metadata?: object }): Promise<void> {
    await db.insert(libraryActivity).values({
      userId: activity.userId,
      fileId: activity.fileId,
      folderId: activity.folderId,
      collectionId: activity.collectionId,
      action: activity.activityType,
      details: activity.metadata,
    });
  }

  async getLibraryActivity(userId: string, limit: number = 50): Promise<LibraryActivityRecord[]> {
    return dbRead.select().from(libraryActivity)
      .where(eq(libraryActivity.userId, userId))
      .orderBy(desc(libraryActivity.createdAt))
      .limit(limit);
  }

  // Chat Message Analysis operations
  async createChatMessageAnalysis(data: InsertChatMessageAnalysis): Promise<ChatMessageAnalysis> {
    const [result] = await db.insert(chatMessageAnalysis).values(data).returning();
    return result;
  }

  async getChatMessageAnalysisByUploadId(uploadId: string): Promise<ChatMessageAnalysis | undefined> {
    const [result] = await dbRead.select()
      .from(chatMessageAnalysis)
      .where(eq(chatMessageAnalysis.uploadId, uploadId))
      .orderBy(desc(chatMessageAnalysis.createdAt))
      .limit(1);
    return result;
  }

  async updateChatMessageAnalysis(id: string, updates: Partial<InsertChatMessageAnalysis>): Promise<ChatMessageAnalysis | undefined> {
    const [result] = await db.update(chatMessageAnalysis)
      .set(updates)
      .where(eq(chatMessageAnalysis.id, id))
      .returning();
    return result;
  }

  // Conversation Documents - Persistent document context
  async createConversationDocument(doc: InsertConversationDocument): Promise<ConversationDocument> {
    const [result] = await db.insert(conversationDocuments).values(doc).returning();
    if (doc.extractedText && doc.extractedText.trim().length > 0) {
      queueMicrotask(() => {
        knowledgeBaseService.ingestConversationDocument({
          chatId: doc.chatId,
          documentId: result.id,
          fileName: doc.fileName,
          content: doc.extractedText || "",
        }).catch((error) => {
          console.warn("[Knowledge] Failed to ingest conversation document:", error?.message || error);
        });
      });
    }
    return result;
  }

  async getConversationDocuments(chatId: string): Promise<ConversationDocument[]> {
    return dbRead.select()
      .from(conversationDocuments)
      .where(eq(conversationDocuments.chatId, chatId))
      .orderBy(conversationDocuments.createdAt);
  }

  async deleteConversationDocument(id: string): Promise<void> {
    await db.delete(conversationDocuments).where(eq(conversationDocuments.id, id));
  }

  // Admin: User monitoring methods
  async getConversationsByUserId(userId: string): Promise<Chat[]> {
    return dbRead.select()
      .from(chats)
      .where(eq(chats.userId, userId))
      .orderBy(desc(chats.updatedAt));
  }

  async getMessagesByConversationId(conversationId: string): Promise<ChatMessage[]> {
    return dbRead.select()
      .from(chatMessages)
      .where(eq(chatMessages.chatId, conversationId))
      .orderBy(chatMessages.createdAt);
  }

  async deleteConversation(conversationId: string): Promise<void> {
    // Delete messages first, then the chat
    await db.delete(chatMessages).where(eq(chatMessages.chatId, conversationId));
    await db.delete(chats).where(eq(chats.id, conversationId));
  }

  async getAuditLogsByResourceId(resourceId: string): Promise<AuditLog[]> {
    return dbRead.select()
      .from(auditLogs)
      .where(eq(auditLogs.resourceId, resourceId))
      .orderBy(desc(auditLogs.createdAt))
      .limit(100);
  }

  async createImpersonationToken(data: { token: string; adminId: string; targetUserId: string; expiresAt: Date }): Promise<void> {
    // Store impersonation token in audit log for security tracking
    await this.createAuditLog({
      action: "impersonation_token_created",
      resource: "users",
      resourceId: data.targetUserId,
      details: {
        adminId: data.adminId,
        tokenHash: data.token.substring(0, 8) + "...", // Only store hash prefix
        expiresAt: data.expiresAt.toISOString()
      }
    });
  }
}

export const storage = new MemStorage();
