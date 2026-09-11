import SwiftUI
import MessagingUI

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
    @State private var position = TiledScrollPosition(autoScrollsToBottomOnAppend: true, scrollsToBottomOnReplace: true)
    @State private var dataSource: ListDataSource<ChatTimelineRow>
    @State private var didInitialScroll = false

    init(rows: [ChatTimelineRow], hasOlder: Bool, isLoadingOlder: Bool, loadOlder: @escaping () async -> Void, dismissKeyboard: @escaping () -> Void, @ViewBuilder rowContent: @escaping (ChatTimelineRow) -> RowContent) {
        self.rows = rows
        self.hasOlder = hasOlder
        self.isLoadingOlder = isLoadingOlder
        self.loadOlder = loadOlder
        self.dismissKeyboard = dismissKeyboard
        self.rowContent = rowContent
        _dataSource = State(initialValue: ListDataSource(items: rows))
    }

    var body: some View {
        TiledView(dataSource: dataSource, scrollPosition: $position) { row in
            TimelineCell(item: row, content: rowContent)
        }
        .prependLoader(hasOlder && didInitialScroll ? .loader(perform: { Task { await loadOlder() } }, isProcessing: isLoadingOlder) {
            HStack(spacing: 7) { ProgressView().controlSize(.small); Text("Loading older messages…") }
                .font(.caption).foregroundStyle(.secondary).padding(.vertical, 8)
        } : nil)
        .onTapBackground(dismissKeyboard)
        .revealConfiguration(.disabled)
        .onAppear { scrollToInitialBottomIfNeeded() }
        .onChange(of: rows) { old, value in
            dataSource.apply(value)
            if old.isEmpty && !value.isEmpty { scrollToInitialBottomIfNeeded() }
        }
    }

    private func scrollToInitialBottomIfNeeded() {
        guard !didInitialScroll, !rows.isEmpty else { return }
        Task { @MainActor in
            await Task.yield()
            await Task.yield()
            position.scrollTo(edge: .bottom, animated: false)
            didInitialScroll = true
        }
    }
}

private struct TimelineCell<Content: View>: TiledCellContent {
    typealias StateValue = Void
    let item: ChatTimelineRow
    let content: (ChatTimelineRow) -> Content
    func body(context: CellContext<Void>) -> some View { content(item) }
}
