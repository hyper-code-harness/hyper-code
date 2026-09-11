import SwiftUI

struct HealthSyncView: View {
    let baseURL: URL
    @StateObject private var sync = HealthKitSleepSync.shared
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Section("Sync") {
                    HStack { Label(sync.status.authorized ? "Health access enabled" : "Health access required", systemImage: sync.status.authorized ? "checkmark.shield.fill" : "heart.text.square"); Spacer(); if sync.status.syncing { ProgressView() } }
                    LabeledContent("State", value: sync.status.message)
                    LabeledContent("Last successful check", value: format(sync.status.lastSync))
                    Button(sync.status.authorized ? "Sync now" : "Allow Health Access") { Task { await sync.requestAndSync(baseURL: baseURL) } }.disabled(sync.status.syncing)
                }
                Section("Metrics on server") {
                    ForEach(healthMetricDisplays) { definition in metric(definition) }
                }
                Section("Canonical health record") {
                    if let sleep = sync.status.canonicalSleep {
                        LabeledContent("Latest sleep night", value: format(sleep.recordedAt))
                        LabeledContent("Sleep ended", value: format(sleep.sleepEnd))
                        LabeledContent("Total sleep", value: sleep.totalMinutes.map { "\($0 / 60)h \($0 % 60)m" } ?? "—")
                    } else { Text("No canonical sleep received").foregroundStyle(.secondary) }
                }
                Section("History backfill") {
                    ForEach(healthMetricDisplays) { definition in
                        let cursor = sync.status.historyBeforeByKind[definition.id]
                        let done = sync.status.historyCompleteByKind[definition.id] == true
                        LabeledContent(definition.title, value: done ? "Complete" : cursor.map { "Back to \($0.formatted(date: .abbreviated, time: .omitted))" } ?? "Not started")
                    }
                    Text("Fresh data uploads first. While Hyper is active, bounded history pages continue backward every 5 minutes.").font(.caption).foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Health Sync")
            .refreshable { await sync.refreshServerStatus(baseURL) }
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .task { await sync.refreshServerStatus(baseURL); await sync.syncIfAuthorized(baseURL: baseURL) }
        }
    }

    private func metric(_ definition: HealthMetricDisplay) -> some View {
        let server = sync.status.serverMetrics.first { $0.kind == definition.id }
        let local = sync.status.latestByKind[definition.id]
        return VStack(alignment: .leading, spacing: 5) {
            Label(definition.title, systemImage: definition.icon).font(.headline)
            LabeledContent("Latest metric", value: format(server?.latestRecentMetric ?? server?.latestMetric ?? local))
            LabeledContent("Last server upload", value: format(server?.latestUpload))
            LabeledContent("Stored samples", value: server.map { $0.samples.formatted() } ?? "0")
            LabeledContent("Last sync changes", value: (sync.status.lastChanges[definition.id] ?? 0).formatted())
        }.padding(.vertical, 4)
    }
    private func format(_ date: Date?) -> String { date?.formatted(date: .abbreviated, time: .shortened) ?? "Never" }
}
