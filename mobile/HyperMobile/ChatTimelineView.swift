import SwiftUI

struct ChatTimelineRow: Identifiable, Equatable {
    enum Kind: Equatable { case event(MobileEvent); case tools([MobileEvent]); case pending(MobileEvent); case partial(PartialAssistant) }
    let id: String
    let kind: Kind
}

struct ChatTimelineView<RowContent: View>: View {
    let rows: [ChatTimelineRow]
    let hasOlder: Bool
    let isLoadingOlder: Bool
    let loadOlder: () async -> Void
    let dismissKeyboard: () -> Void
    @ViewBuilder let rowContent: (ChatTimelineRow) -> RowContent

    @State private var didInitialScroll = false
    private let bottomID = "chat-timeline-bottom"

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 0) {
                    if hasOlder {
                        Button {
                            Task { await loadOlder() }
                        } label: {
                            HStack(spacing: 7) {
                                if isLoadingOlder { ProgressView().controlSize(.small) }
                                Text(isLoadingOlder ? "Loading older messages…" : "Load older messages")
                            }
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .padding(.vertical, 10)
                            .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.plain)
                        .disabled(isLoadingOlder)
                    }

                    ForEach(rows) { row in
                        rowContent(row)
                            .id(row.id)
                    }

                    Color.clear.frame(height: 1).id(bottomID)
                }
            }
            .contentShape(Rectangle())
            .onTapGesture(perform: dismissKeyboard)
            .onAppear { scrollToBottom(proxy, animated: false) }
            .onChange(of: rows) { oldRows, newRows in
                guard !newRows.isEmpty else { return }
                if let oldFirst = oldRows.first,
                   newRows.first?.id != oldFirst.id,
                   newRows.contains(where: { $0.id == oldFirst.id }),
                   newRows.last?.id == oldRows.last?.id {
                    restorePrependAnchor(oldFirst.id, proxy: proxy)
                } else {
                    scrollToBottom(proxy, animated: didInitialScroll)
                }
            }
        }
    }

    private func scrollToBottom(_ proxy: ScrollViewProxy, animated: Bool) {
        guard !rows.isEmpty else { return }
        Task { @MainActor in
            await Task.yield()
            await Task.yield()
            if animated {
                withAnimation(.easeOut(duration: 0.18)) { proxy.scrollTo(bottomID, anchor: .bottom) }
            } else {
                proxy.scrollTo(bottomID, anchor: .bottom)
            }
            didInitialScroll = true
        }
    }

    private func restorePrependAnchor(_ id: String, proxy: ScrollViewProxy) {
        Task { @MainActor in
            await Task.yield()
            proxy.scrollTo(id, anchor: .top)
        }
    }
}
