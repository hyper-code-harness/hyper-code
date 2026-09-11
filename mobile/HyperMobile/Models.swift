import Foundation

struct AgentSummary: Codable, Identifiable, Hashable {
    let id: String
    let title: String
    let model: String
    let runState: String
    let unread: Int
    let turns: Int
    let updatedAt: Double
    let workspaceDir: String
    let pinned: Bool
    let delegated: Bool

    let visibility: String
    var isRunning: Bool { runState == "running" || runState == "claimed" }
}

struct NewsResponse: Codable { let version: Int; let items: [NewsItem]; let stats: NewsStats; let sources: [NewsSource] }
struct NewsStats: Codable { let total: Int; let unread: Int; let liked: Int; let sources: Int }
struct NewsSource: Codable, Hashable, Identifiable { let source: String; let label: String; let total: Int; let unread: Int; let latest: String?; var id: String { source } }
struct NewsItem: Codable, Identifiable, Hashable {
    let id: String; let title: String; let source: String; let sourceLabel: String; let url: String?; let imageURL: String?; let author: String?; let points: Int?; let comments: Int?; let summary: String; let summaryLong: String; let topics: [String]; var liked: Bool; var read: Bool; let shownAt: String?
}
struct NewsLikeResponse: Codable { let version: Int; let id: String; let liked: Bool }

struct ReadNewsResponse: Codable { let version: Int; let id: String; let read: Bool; let updated: Int }


struct NewsAgentResponse: Codable { let version: Int; let id: String; let workspaceDir: String; let started: Bool }
struct SleepUploadSession: Codable { let recordedAt: Date; let sleepStart: Date?; let sleepEnd: Date?; let inBedStart: Date?; let inBedEnd: Date?; let totalMinutes: Int; let deepMinutes: Int; let remMinutes: Int; let coreMinutes: Int; let awakeMinutes: Int; let source: String }
struct SleepSyncResponse: Codable { let version: Int; let ok: Bool; let inserted: Int; let updated: Int }
struct HealthSampleUpload: Codable { let id: String; let recordedAt: Date; let startAt: Date?; let endAt: Date?; let value: [String: Double]; let source: String }
struct HealthSamplesResponse: Codable { let version: Int; let ok: Bool; let inserted: Int; let updated: Int }
struct HealthServerMetric: Codable, Identifiable { let kind: String; let samples: Int; let earliestMetric: Date?; let latestMetric: Date?; let latestRecentMetric: Date?; let latestUpload: Date?; var id: String { kind } }
struct CanonicalSleepStatus: Codable { let recordedAt: Date?; let sleepEnd: Date?; let totalMinutes: Int? }
struct HealthServerStatus: Codable { let version: Int; let metrics: [HealthServerMetric]; let canonicalSleep: CanonicalSleepStatus? }
struct NewAgentOptions: Codable {
    let version: Int
    let defaultModel: String
    let models: [MobileModel]
    let workspaces: [String]
}
struct MobileModel: Codable, Hashable, Identifiable { let provider: String; let model: String; var id: String { model } }
struct CreatedAgentResponse: Codable { let version: Int; let agent: CreatedAgent }
struct CreatedAgent: Codable { let id: String; let title: String; let model: String; let workspaceDir: String }


struct AgentsResponse: Codable { let version: Int; let agents: [AgentSummary] }

struct MobileEvent: Codable, Identifiable, Hashable {
    let idx: Int
    let ts: Double
    let type: String
    let text: String?
    let name: String?
    let preview: String?
    let isError: Bool
    let attachments: [EventAttachment]
    var id: Int { idx }
}

struct EventAttachment: Codable, Hashable {
    let id: String?
    let name: String?
    let contentType: String?
    let size: Int?
}

struct EventsResponse: Codable {
    let version: Int
    let agentId: String
    let events: [MobileEvent]
    let nextAfter: Int
    let olderBefore: Int?
    let hasOlder: Bool
    let isRunning: Bool
    let runState: String
    let lastError: String?
    let partial: PartialAssistant?
}
struct PartialAssistant: Codable, Equatable {
    let text: String
    let revision: Int
    let startedAt: Double
}

struct SendResponse: Codable { let version: Int; let ok: Bool; let messageIdx: Int; let eventIdx: Int; let sendAt: Double; let attachments: [EventAttachment]? }
struct PendingAttachment: Identifiable, Hashable {
    let id: UUID
    let name: String
    let contentType: String
    let data: Data
    var isImage: Bool { contentType.hasPrefix("image/") }
}
struct CompactResponse: Codable { let version: Int; let ok: Bool; let status: String }
struct DeleteAgentResponse: Codable { let version: Int; let ok: Bool; let agentId: String }

struct ArchiveAgentResponse: Codable { let version: Int; let ok: Bool; let agentId: String; let archived: Bool }
struct StopResponse: Codable { let version: Int; let ok: Bool; let agentId: String }
struct ModelChangeResponse: Codable { let version: Int; let ok: Bool; let model: String; let from: String? }
struct PinResponse: Codable { let version: Int; let agentId: String; let pinned: Bool }
struct InjectResponse: Codable { let version: Int; let text: String; let every: Int }
struct ReadResponse: Codable { let version: Int; let ok: Bool; let agentId: String; let seenAt: Double }
struct ToolDetailResponse: Codable { let version: Int; let event: ToolDetail }
struct ToolDetail: Codable, Identifiable {
    let idx: Int
    let ts: Double
    let type: String
    let name: String
    let args: String
    let argsTruncated: Bool
    let result: String
    let resultTruncated: Bool
    let isError: Bool
    var id: Int { idx }
}
struct APIErrorBody: Codable { let error: String?; let message: String? }
