import SwiftUI
import PhotosUI
import UniformTypeIdentifiers
import MarkdownUI
import MessagingUI

private enum ChatItem: Identifiable {
    case event(MobileEvent)
    case tools([MobileEvent])
    var id: String {
        switch self { case .event(let event): "event-\(event.idx)"; case .tools(let tools): "tools-\(tools.first?.idx ?? -1)" }
    }
}

struct NativeChatView: View {
    let agent: AgentSummary
    let baseURL: URL
    let onRead: () -> Void
    let onNextUnread: (() -> Void)?
    @StateObject private var store = ChatStore()
    @State private var draft = ""
    @State private var composerResetID = UUID()
    @State private var attachments: [PendingAttachment] = []
    @State private var selectedTool: MobileEvent?
    @State private var selectedToolGroup: ToolGroupSelection?
    @FocusState private var focused: Bool

    @Environment(\.dismiss) private var dismiss
    @State private var swipeTranslation: CGFloat = 0
    @State private var showingDeleteConfirmation = false
    @State private var actionMessage: String?
    @State private var actionInFlight = false
    @State private var showingModelPicker = false
    @State private var currentModel: String
    @State private var showingInjectEditor = false
    @State private var showingFiles = false
    @State private var injectText = ""
    @State private var injectEvery = 1

    init(agent: AgentSummary, baseURL: URL, onRead: @escaping () -> Void, onNextUnread: (() -> Void)? = nil) {
        self.agent = agent
        self.baseURL = baseURL
        self.onRead = onRead
        self.onNextUnread = onNextUnread
        _currentModel = State(initialValue: agent.model)
    }

    private var items: [ChatItem] {
        var result: [ChatItem] = [], tools: [MobileEvent] = []
        func flush() { if !tools.isEmpty { result.append(.tools(tools)); tools.removeAll() } }
        for event in store.events {
            if event.type == "tool_call" || event.type == "tool_result" { tools.append(event) }
            else { flush(); result.append(.event(event)) }
        }
        flush(); return result
    }

    private var timelineRows: [ChatTimelineRow] {
        var rows = items.map { item -> ChatTimelineRow in
            switch item {
            case .event(let event): return .init(id: item.id, kind: .event(event))
            case .tools(let tools): return .init(id: item.id, kind: .tools(tools))
            }
        }
        if let pending = store.pendingUserEvent { rows.append(.init(id: "pending-user", kind: .pending(pending))) }
        if let partial = store.partial { rows.append(.init(id: "live-assistant", kind: .partial(partial))) }
        return rows
    }

    var body: some View {
        ZStack {
            DotGridBackground()
            VStack(spacing: 0) {
            if let error = store.error { ErrorBanner(message: error) }
            ChatTimelineView(
                rows: timelineRows,
                hasOlder: store.hasOlder,
                isLoadingOlder: store.isLoadingOlder,
                loadOlder: { await store.loadOlder(baseURL: baseURL, agentID: agent.id) },
                dismissKeyboard: { focused = false }
            ) { row in
                Group {
                    switch row.kind {
                    case .event(let event), .pending(let event): EventBubble(event: event, agentID: agent.id, baseURL: baseURL)
                    case .tools(let tools): ToolTray(events: tools) { selectedToolGroup = ToolGroupSelection(events: tools) }
                    case .partial(let partial): LiveAssistantBubble(partial: partial)
                    }
                }
                .frame(maxWidth: 860)
                .padding(.horizontal, 20)
                .padding(.vertical, 5)
            }
            .scrollDismissesKeyboard(.immediately)
                AttachmentComposer(text: $draft, attachments: $attachments, focused: $focused, resetID: composerResetID, sending: store.isSending, running: store.isRunning, injectText: injectText, injectEvery: injectEvery, send: sendAction, stop: stopAction)
                    .frame(maxWidth: 860)
                    .frame(maxWidth: .infinity)
            }
        }
        .background(Color(.systemGroupedBackground))
        .navigationTitle(agent.title).navigationBarTitleDisplayMode(.inline)
        .offset(x: swipeTranslation)
        .simultaneousGesture(
            DragGesture(minimumDistance: 18)
                .onChanged { value in
                    let horizontal = abs(value.translation.width) > abs(value.translation.height) * 1.5
                    guard horizontal else { return }
                    if value.startLocation.x < 32, value.translation.width > 0 {
                        swipeTranslation = min(90, value.translation.width * 0.35)
                    } else if value.translation.width < 0, onNextUnread != nil {
                        swipeTranslation = max(-110, value.translation.width * 0.35)
                    }
                }
                .onEnded { value in
                    let goBack = value.startLocation.x < 32 && (value.translation.width > 90 || value.predictedEndTranslation.width > 180)
                    let goNext = onNextUnread != nil && (value.translation.width < -55 || value.predictedEndTranslation.width < -110) && abs(value.translation.width) > abs(value.translation.height)
                    if goNext {
                        UIImpactFeedbackGenerator(style: .light).impactOccurred()
                        withAnimation(.easeOut(duration: 0.12)) { swipeTranslation = -UIScreen.main.bounds.width * 0.28 }
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.12) { swipeTranslation = 0; onNextUnread?() }
                    } else {
                        withAnimation(.snappy(duration: 0.2)) { swipeTranslation = 0 }
                        if goBack { dismiss() }
                    }
                }
        )
        .toolbar { chatToolbar }
        .task { await store.start(baseURL: baseURL, agentID: agent.id) }
        .onDisappear { store.stopPolling(); onRead() }
        .sheet(item: $selectedToolGroup) { group in ToolListSheet(events: group.events) { event in selectedToolGroup = nil; DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { selectedTool = event } } }
        .sheet(item: $selectedTool) { event in ToolDetailSheet(baseURL: baseURL, agentID: agent.id, event: event) }
        .sheet(isPresented: $showingModelPicker) { ModelPickerSheet(baseURL: baseURL, agentID: agent.id, selection: $currentModel) }
        .sheet(isPresented: $showingInjectEditor) { InjectEditorSheet(baseURL: baseURL, agentID: agent.id, text: $injectText, every: $injectEvery) }
        .fullScreenCover(isPresented: $showingFiles) { FileBrowserView(baseURL: baseURL, workspacePath: agent.workspaceDir) }
        .alert("Delete this chat?", isPresented: $showingDeleteConfirmation) {
            Button("Cancel", role: .cancel) {}
            Button("Delete", role: .destructive) { deleteChat() }
        } message: { Text("The transcript and attachments will be permanently removed.") }
        .alert("Chat", isPresented: Binding(get: { actionMessage != nil }, set: { if !$0 { actionMessage = nil } })) {
            Button("OK") { actionMessage = nil }
        } message: { Text(actionMessage ?? "") }
    }


    @ToolbarContentBuilder private var chatToolbar: some ToolbarContent {
        ToolbarItem(placement: .principal) {
            VStack(spacing: 2) { Text(agent.title).font(.headline).lineLimit(1); AgentActivityStatus(running: store.isRunning) }
        }
        ToolbarItem(placement: .topBarTrailing) {
            Menu {
                Button { showingModelPicker = true } label: { Label("Change model", systemImage: "cpu") }
                Button { showingInjectEditor = true } label: { Label("Prompt inject", systemImage: "text.badge.plus") }
                Button { showingFiles = true } label: { Label("Browse files", systemImage: "folder") }
                Button { compact() } label: { Label("Compact context", systemImage: "arrow.trianglehead.2.clockwise.rotate.90") }.disabled(store.isRunning || actionInFlight)
                Divider()
                Button(role: .destructive) { showingDeleteConfirmation = true } label: { Label("Delete chat", systemImage: "trash") }.disabled(actionInFlight)
            } label: { Image(systemName: "ellipsis").font(.headline).frame(width: 38, height: 38).background(Color(.secondarySystemBackground), in: Circle()) }
                .accessibilityLabel("Chat actions")
        }
    }

    private var sendAction: () -> Void { { send() } }
    private var stopAction: () -> Void { { stop() } }
    private var modelDisplayName: String { currentModel.split(separator: ":", maxSplits: 1).last.map(String.init) ?? currentModel }
    private func send() {
        let value = draft, selected = attachments
        guard !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !selected.isEmpty else { return }
        // Clear and recreate the native text field before awaiting the network.
        // This also cancels any pending keyboard-dictation composition that could
        // otherwise write its final transcript back after Send was tapped.
        focused = false
        draft = ""
        attachments = []
        composerResetID = UUID()
        Task {
            let sent = await store.send(value, attachments: selected, baseURL: baseURL, agentID: agent.id)
            if !sent {
                draft = value
                attachments = selected
                composerResetID = UUID()
            }
        }
    }
    private func stop() { Task { await store.stop(baseURL: baseURL, agentID: agent.id) } }
    private func compact() {
        actionInFlight = true
        Task {
            do { let result = try await APIClient(baseURL: baseURL).compact(agentID: agent.id); actionMessage = result.status == "not_needed" ? "Context is already compact." : "Context compacted." }
            catch { actionMessage = error.localizedDescription }
            actionInFlight = false
        }
    }
    private func deleteChat() {
        actionInFlight = true
        Task {
            do { _ = try await APIClient(baseURL: baseURL).deleteAgent(agentID: agent.id); store.stopPolling(); onRead(); dismiss() }
            catch { actionMessage = error.localizedDescription }
            actionInFlight = false
        }
    }
}

private struct AgentActivityStatus: View {
    let running: Bool
    @State private var pulse = false
    var body: some View {
        HStack(spacing: 5) {
            if running {
                HStack(spacing: 2) {
                    ForEach(0..<3, id: \.self) { index in
                        Circle().fill(Color.secondary).frame(width: 3.5, height: 3.5)
                            .scaleEffect(pulse ? 1 : 0.55).opacity(pulse ? 0.9 : 0.35)
                            .animation(.easeInOut(duration: 0.65).repeatForever().delay(Double(index) * 0.14), value: pulse)
                    }
                }
                Text("Thinking").font(.caption2).foregroundStyle(.secondary)
            }
        }.frame(height: 12).onAppear { pulse = true }
    }
}


struct DotGridBackground: View {
    @Environment(\.colorScheme) private var colorScheme
    var body: some View {
        Canvas { context, size in
            let color = colorScheme == .dark ? Color.white.opacity(0.12) : Color.black.opacity(0.085)
            var path = Path()
            var y: CGFloat = 8
            while y < size.height {
                var x: CGFloat = 8
                while x < size.width {
                    path.addEllipse(in: CGRect(x: x - 1, y: y - 1, width: 2, height: 2))
                    x += 16
                }
                y += 16
            }
            context.fill(path, with: .color(color))
        }
        .background(Color(.systemGroupedBackground))
        .ignoresSafeArea()
        .accessibilityHidden(true)
        .allowsHitTesting(false)
    }
}

private struct ToolGroupSelection: Identifiable {
    let id = UUID()
    let events: [MobileEvent]
}

private struct ToolTray: View {
    let events: [MobileEvent]
    let open: () -> Void
    private var calls: [MobileEvent] { events.filter { $0.type == "tool_call" } }
    private var errors: Int { events.filter(\.isError).count }
    var body: some View {
        Button(action: open) {
            HStack(spacing: 8) {
                Image(systemName: "terminal").font(.caption.weight(.semibold))
                Text("Ran \(calls.count) \(calls.count == 1 ? "command" : "commands")")
                    .font(.subheadline.weight(.medium))
                if errors > 0 { Text("\(errors)").font(.caption2.bold()).foregroundStyle(.white).padding(.horizontal, 6).background(.red, in: Capsule()) }
                Spacer(minLength: 8)
                Image(systemName: "chevron.right").font(.caption.weight(.semibold))
            }
            .foregroundStyle(.secondary)
            .contentShape(Rectangle())
            .padding(.vertical, 4)
        }
        .buttonStyle(.plain)
        .accessibilityHint("Show command list")
    }
}

private struct ToolListSheet: View {
    let events: [MobileEvent]
    let select: (MobileEvent) -> Void
    @Environment(\.dismiss) private var dismiss
    private var calls: [MobileEvent] { events.filter { $0.type == "tool_call" } }
    var body: some View {
        NavigationStack {
            List(calls) { event in
                Button { select(event) } label: {
                    HStack(spacing: 12) {
                        Image(systemName: icon(event.name)).font(.body.weight(.medium)).frame(width: 24)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(event.preview ?? displayName(event.name))
                                .font(.callout.weight(.medium)).foregroundStyle(.primary).lineLimit(1)
                            Text(displayName(event.name))
                                .font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        if event.isError { Image(systemName: "exclamationmark.circle.fill").foregroundStyle(.red) }
                        Image(systemName: "chevron.right").font(.caption).foregroundStyle(.tertiary)
                    }.contentShape(Rectangle())
                }.buttonStyle(.plain)
            }
            .navigationTitle("Ran \(calls.count) \(calls.count == 1 ? "command" : "commands")")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button { dismiss() } label: { Image(systemName: "xmark") } } }
        }
        .presentationDetents([.medium, .large])
    }
    private func displayName(_ name: String?) -> String {
        switch name { case "read": "File read"; case "write": "File write"; case "edit": "File edit"; case "grep": "Text search"; case "find": "File search"; case "bash": "Shell command"; case "eval": "Code evaluation"; default: name ?? "Tool" }
    }
    private func icon(_ name: String?) -> String {
        switch name { case "read": "doc.text"; case "write", "edit": "square.and.pencil"; case "grep", "find": "magnifyingglass"; case "bash": "terminal"; case "eval": "chevron.left.forwardslash.chevron.right"; default: "wrench.and.screwdriver" }
    }
}

private struct ToolDetailSheet: View {
    let baseURL: URL, agentID: String, event: MobileEvent
    @State private var detail: ToolDetail?
    @State private var error: String?
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            Group {
                if let detail {
                    ScrollView { VStack(alignment: .leading, spacing: 18) { section("Arguments", detail.args, detail.argsTruncated); section(detail.isError ? "Error" : "Result", detail.result, detail.resultTruncated) }.padding() }
                } else if let error { ContentUnavailableView("Couldn’t load tool", systemImage: "exclamationmark.triangle", description: Text(error)) }
                else { ProgressView("Loading tool…") }
            }
            .navigationTitle(event.name ?? "Tool").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }.presentationDetents([.medium, .large]).task { do { detail = try await APIClient(baseURL: baseURL).toolDetail(agentID: agentID, eventIndex: event.idx) } catch { self.error = error.localizedDescription } }
    }
    private func section(_ title: String, _ text: String, _ truncated: Bool) -> some View {
        VStack(alignment: .leading, spacing: 7) { HStack { Text(title).font(.headline); if truncated { Text("truncated").font(.caption2).foregroundStyle(.orange) } }; ScrollView(.horizontal, showsIndicators: true) { Text(text.isEmpty ? "—" : text).font(.system(.caption, design: .monospaced)).textSelection(.enabled).fixedSize(horizontal: true, vertical: false).padding(12) }.frame(maxWidth: .infinity, alignment: .leading).background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 12)) }
    }
}

private struct LiveAssistantBubble: View {
    let partial: PartialAssistant
    var body: some View {
        HStack(alignment: .bottom) {
            VStack(alignment: .leading, spacing: 8) {
                NativeMessageText(text: partial.text)
                HStack(spacing: 5) { ProgressView().controlSize(.mini); Text("Responding…").font(.caption2).foregroundStyle(.secondary) }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, 7)
            .textSelection(.enabled)
            Spacer(minLength: 0)
        }
    }
}

private struct EventBubble: View {
    let event: MobileEvent
    let agentID: String
    let baseURL: URL
    @State private var preview: ImagePreview?
    @Environment(\.colorScheme) private var colorScheme
    private var isUser: Bool { event.type == "user" }
    private var imageAttachments: [EventAttachment] { event.attachments.filter { $0.contentType?.hasPrefix("image/") == true && $0.id != nil } }
    private var otherAttachments: [EventAttachment] { event.attachments.filter { $0.contentType?.hasPrefix("image/") != true } }

    var body: some View {
        HStack(alignment: .bottom) {
            if isUser { Spacer(minLength: 54) }
            VStack(alignment: .leading, spacing: 7) {
                if let text = event.text, !text.isEmpty { NativeMessageText(text: text, foreground: isUser ? userTextColor : nil) }
                if !imageAttachments.isEmpty {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 7) {
                            ForEach(Array(imageAttachments.enumerated()), id: \.offset) { _, attachment in
                                if let url = attachmentURL(attachment) {
                                    Button { preview = ImagePreview(url: url, name: attachment.name ?? "Photo") } label: {
                                        AuthenticatedRemoteImage(url: url) { image, failed in
                                            if let image { Image(uiImage: image).resizable().scaledToFill() }
                                            else if failed { Image(systemName: "photo.badge.exclamationmark").foregroundStyle(.secondary) }
                                            else { ProgressView() }
                                        }
                                        .frame(width: 112, height: 84).background(Color.primary.opacity(0.06)).clipShape(RoundedRectangle(cornerRadius: 11))
                                    }.buttonStyle(.plain)
                                }
                            }
                        }
                    }
                }
                ForEach(Array(otherAttachments.enumerated()), id: \.offset) { _, attachment in Label(attachment.name ?? "Attachment", systemImage: "paperclip").font(.caption) }
            }
            .frame(maxWidth: isUser ? nil : .infinity, alignment: .leading)
            .padding(.horizontal, isUser ? 12 : 0).padding(.vertical, isUser ? 9 : 7)
            .background(isUser ? userBubbleColor : Color.clear, in: RoundedRectangle(cornerRadius: 17, style: .continuous))
            .foregroundStyle(isUser ? userTextColor : (event.type == "error" ? Color.red : Color.primary)).textSelection(.enabled)
            if !isUser { Spacer(minLength: 0) }
        }
        .sheet(item: $preview) { item in ImagePreviewSheet(item: item) }
    }

    private var userBubbleColor: Color {
        colorScheme == .dark
            ? Color(red: 0.10, green: 0.22, blue: 0.38)
            : Color(red: 0.76, green: 0.87, blue: 1.0)
    }

    private var userTextColor: Color {
        colorScheme == .dark ? .white : Color(red: 0.04, green: 0.08, blue: 0.14)
    }

    private func attachmentURL(_ attachment: EventAttachment) -> URL? {
        guard let id = attachment.id else { return nil }
        return baseURL.appending(path: "attachments/\(agentID)/\(id)")
    }
}
private struct ImagePreview: Identifiable { let id = UUID(); let url: URL; let name: String }
private struct ImagePreviewSheet: View {
    let item: ImagePreview
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            ZoomableRemoteImage(url: item.url).background(.black).ignoresSafeArea(edges: .bottom)
                .navigationTitle(item.name).navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }
}
private struct ZoomableRemoteImage: View {
    let url: URL
    @State private var scale: CGFloat = 1
    var body: some View {
        AuthenticatedRemoteImage(url: url) { image, failed in
            if let image { Image(uiImage: image).resizable().scaledToFit().scaleEffect(scale).gesture(MagnifyGesture().onChanged { scale = max(1, min(5, $0.magnification)) }) }
            else if failed { ContentUnavailableView("Couldn’t load image", systemImage: "photo.badge.exclamationmark") }
            else { ProgressView().tint(.white) }
        }.frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}


private struct NativeMessageText: View {
    let text: String
    var foreground: Color? = nil
    var body: some View {
        Markdown(text)
            .markdownTheme(.hyperChat)
            .markdownTextStyle { ForegroundColor(foreground ?? .primary) }
            .textSelection(.enabled)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}
private struct ErrorBanner: View { let message: String; var body: some View { Label(message, systemImage: "exclamationmark.triangle.fill").font(.caption).foregroundStyle(.white).frame(maxWidth: .infinity).padding(8).background(.red) } }
