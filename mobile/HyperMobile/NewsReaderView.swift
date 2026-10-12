import SwiftUI
import MarkdownUI

private enum NewsViewMode: String, CaseIterable, Identifiable {
    case unread, all, liked
    var id: String { rawValue }
    var title: String { switch self { case .unread: "Unread"; case .all: "Archive"; case .liked: "Liked" } }
}

struct NewsReaderView: View {
    let baseURL: URL
    @Environment(\.dismiss) private var dismiss
    @State private var items: [NewsItem] = []
    @State private var stats = NewsStats(total: 0, unread: 0, liked: 0, sources: 0)
    @State private var sources: [NewsSource] = []
    @State private var mode: NewsViewMode = .unread
    @State private var source: String?
    @State private var query = ""
    @State private var loading = true
    @State private var error: String?
    @State private var selectedItem: NewsItem?

    var body: some View {
        Group {
            if loading && items.isEmpty { ProgressView("Loading news…") }
            else if let error, items.isEmpty { ContentUnavailableView("Couldn’t load news", systemImage: "newspaper", description: Text(error)) }
            else {
                List {
                    Section {
                        Picker("News view", selection: $mode) {
                            Text("Unread \(stats.unread)").tag(NewsViewMode.unread)
                            Text("Archive \(stats.total)").tag(NewsViewMode.all)
                            Text("Liked \(stats.liked)").tag(NewsViewMode.liked)
                        }.pickerStyle(.segmented).listRowSeparator(.hidden)

                        if !sources.isEmpty {
                            ScrollView(.horizontal, showsIndicators: false) {
                                HStack(spacing: 7) {
                                    sourceChip(nil, label: "All", count: mode == .unread ? stats.unread : stats.total)
                                    ForEach(sources) { value in sourceChip(value.source, label: value.label, count: mode == .unread ? value.unread : value.total) }
                                }.padding(.vertical, 2)
                            }.listRowSeparator(.hidden)
                        }
                    }.listRowBackground(Color.clear)

                    Section {
                        if items.isEmpty {
                            ContentUnavailableView(mode == .unread ? "All caught up" : "No stories", systemImage: mode == .unread ? "checkmark.circle" : "newspaper", description: Text(mode == .unread ? "There are no unread stories in this view." : "Try another filter or search."))
                                .frame(maxWidth: .infinity).listRowSeparator(.hidden)
                        } else {
                            ForEach(items) { item in
                                Button { selectedItem = item } label: { NewsCard(item: item).contentShape(Rectangle()) }
                                    .buttonStyle(.plain)
                                    .swipeActions(edge: .trailing) { Button { toggleLike(item) } label: { Label(item.liked ? "Unlike" : "Like", systemImage: item.liked ? "heart.slash" : "heart") }.tint(.pink) }
                            }
                        }
                    }
                }
                .listStyle(.plain)
                .refreshable { await load() }
            }
        }
        .navigationTitle("News")
        .navigationBarTitleDisplayMode(.large)
        .searchable(text: $query, prompt: "Search the archive")
        .onSubmit(of: .search) { Task { await load() } }
        .onChange(of: mode) { _, _ in Task { await load() } }
        .onChange(of: source) { _, _ in Task { await load() } }
        .task { await load() }
        .onAppear { if !loading { Task { await load() } } }
        .navigationDestination(item: $selectedItem) { item in
            NewsDetailView(baseURL: baseURL, items: items, initialID: item.id, likedChanged: { id, liked in update(id, liked: liked) }, readChanged: { id in markLocalRead(id) })
        }
    }

    private func sourceChip(_ value: String?, label: String, count: Int) -> some View {
        Button { source = value } label: {
            HStack(spacing: 4) { Text(label); Text("\(count)").font(.caption2.bold()).opacity(0.7) }
                .font(.caption.weight(.medium)).padding(.horizontal, 10).padding(.vertical, 6)
                .foregroundStyle(source == value ? Color.white : Color.primary)
                .background(source == value ? Color.accentColor : Color(.secondarySystemBackground), in: Capsule())
        }.buttonStyle(.plain)
    }

    private func load() async {
        loading = true; defer { loading = false }
        do { let response = try await APIClient(baseURL: baseURL).news(view: mode.rawValue, source: source, query: query); items = response.items; stats = response.stats; sources = response.sources; error = nil }
        catch { self.error = error.localizedDescription }
    }
    private func toggleLike(_ item: NewsItem) { let desired = !item.liked; update(item.id, liked: desired); Task { _ = try? await APIClient(baseURL: baseURL).setNewsLiked(id: item.id, liked: desired) } }
    private func update(_ id: String, liked: Bool) { if let i = items.firstIndex(where: { $0.id == id }) { items[i].liked = liked } }
    private func markLocalRead(_ id: String) {
        guard let i = items.firstIndex(where: { $0.id == id }), !items[i].read else { return }
        items[i].read = true
        stats = NewsStats(total: stats.total, unread: max(0, stats.unread - 1), liked: stats.liked, sources: stats.sources)
    }
}

private struct NewsCard: View {
    let item: NewsItem
    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            HStack(spacing: 7) {
                Text(String(item.sourceLabel.prefix(2)).uppercased()).font(.caption2.bold()).foregroundStyle(.tint).frame(width: 32, height: 32).background(Color.accentColor.opacity(0.12), in: RoundedRectangle(cornerRadius: 9))
                VStack(alignment: .leading, spacing: 1) { Text(item.sourceLabel).font(.caption.weight(.medium)).foregroundStyle(.secondary); if let date = item.shownAt { Text(String(date.prefix(10))).font(.caption2).foregroundStyle(.tertiary) } }
                Spacer()
                if item.liked { Image(systemName: "heart.fill").font(.caption).foregroundStyle(.pink) }
                if !item.read { Circle().fill(Color.accentColor).frame(width: 7, height: 7) }
            }
            Text(item.title).font(.headline).foregroundStyle(.primary).fixedSize(horizontal: false, vertical: true)
            if let raw = item.imageURL, let url = URL(string: raw) { AsyncImage(url: url) { phase in if let image = phase.image { image.resizable().scaledToFill() } else { Color(.secondarySystemBackground) } }.frame(height: 180).clipShape(RoundedRectangle(cornerRadius: 13)) }
            if !item.summary.isEmpty { Text(item.summary).font(.subheadline).foregroundStyle(.secondary).lineLimit(3) }
            HStack(spacing: 13) { if let points = item.points { Label("\(points)", systemImage: "arrow.up") }; if let comments = item.comments { Label("\(comments)", systemImage: "bubble.left") } }.font(.caption).foregroundStyle(.tertiary)
        }.padding(.vertical, 8)
    }
}

private struct NewsDetailView: View {
    let baseURL: URL
    @State private var items: [NewsItem]
    @State private var index: Int
    let likedChanged: (String, Bool) -> Void
    let readChanged: (String) -> Void
    @State private var horizontalDrag: CGFloat = 0
    @State private var showingAgent = false
    private var item: NewsItem { items[index] }

    init(baseURL: URL, items: [NewsItem], initialID: String, likedChanged: @escaping (String, Bool) -> Void, readChanged: @escaping (String) -> Void = { _ in }) {
        self.baseURL = baseURL
        _items = State(initialValue: items)
        _index = State(initialValue: items.firstIndex(where: { $0.id == initialID }) ?? 0)
        self.likedChanged = likedChanged
        self.readChanged = readChanged
    }

    var body: some View {
        article(item)
            .id(item.id)
            .offset(x: horizontalDrag)
            .simultaneousGesture(
                DragGesture(minimumDistance: 20)
                    .onChanged { value in
                        guard abs(value.translation.width) > abs(value.translation.height) * 1.25 else { return }
                        horizontalDrag = value.translation.width * 0.72
                    }
                    .onEnded { value in
                        guard abs(value.translation.width) > abs(value.translation.height) else { return }
                        if value.translation.width < -55 || value.predictedEndTranslation.width < -110 { turn(next: true) }
                        else if value.translation.width > 55 || value.predictedEndTranslation.width > 110 { turn(next: false) }
                        else { withAnimation(.snappy(duration: 0.2)) { horizontalDrag = 0 } }
                    }
            )
            .navigationTitle("\(index + 1) of \(items.count)")
            .navigationBarTitleDisplayMode(.inline)
            .task(id: item.id) { await markCurrentRead() }
            .sheet(isPresented: $showingAgent) { NewsAgentSheet(baseURL: baseURL, item: item) }
    }

    private func article(_ item: NewsItem) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HStack {
                    Text(item.sourceLabel).font(.caption.weight(.semibold)).foregroundStyle(.tint)
                    if let date = item.shownAt { Text("· \(String(date.prefix(10)))").font(.caption).foregroundStyle(.secondary) }
                    Spacer()
                    ShareLink(item: shareText, subject: Text(item.title)) {
                        Image(systemName: "square.and.arrow.up")
                    }
                    .labelStyle(.iconOnly)
                    .accessibilityLabel("Share")
                    Button { showingAgent = true } label: { Image(systemName: "sparkles") }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Start agent for \(item.title)")
                    Button { toggleLike() } label: { Image(systemName: item.liked ? "heart.fill" : "heart").foregroundStyle(item.liked ? .pink : .primary) }
                }
                Text(item.title).font(.largeTitle.bold()).fixedSize(horizontal: false, vertical: true)
                if let author = item.author, !author.isEmpty { Text(author).font(.subheadline).foregroundStyle(.secondary) }
                if !item.topics.isEmpty { ScrollView(.horizontal, showsIndicators: false) { HStack { ForEach(item.topics, id: \.self) { Text($0).font(.caption2).padding(.horizontal, 8).padding(.vertical, 4).overlay(Capsule().stroke(Color.secondary.opacity(0.3))) } } } }
                if let raw = item.imageURL, let url = URL(string: raw) { AsyncImage(url: url) { phase in if let image = phase.image { image.resizable().scaledToFit() } else { ProgressView() } }.frame(maxWidth: .infinity).clipShape(RoundedRectangle(cornerRadius: 16)) }
                if !item.summary.isEmpty { section("Summary", item.summary) }
                if !item.summaryLong.isEmpty { section("Details", item.summaryLong) }
                if let raw = item.url, let url = URL(string: raw) { Link(destination: url) { Label("Open original", systemImage: "arrow.up.right.square").font(.headline) }.padding(.top, 4) }
                HStack { if index > 0 { Label("Previous", systemImage: "arrow.left") }; Spacer(); if index + 1 < items.count { Label("Next", systemImage: "arrow.right") } }.font(.caption).foregroundStyle(.tertiary).padding(.top, 18)
            }.frame(maxWidth: 760, alignment: .leading).padding(22).frame(maxWidth: .infinity)
        }
    }

    private var shareText: String {
        [item.title, item.summary, item.url].compactMap { value in
            guard let value, !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
            return value
        }.joined(separator: "\n\n")
    }


    private func turn(next: Bool) {
        guard next ? index + 1 < items.count : index > 0 else { withAnimation(.snappy) { horizontalDrag = 0 }; UINotificationFeedbackGenerator().notificationOccurred(.warning); return }
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        withAnimation(.easeOut(duration: 0.14)) { horizontalDrag = next ? -UIScreen.main.bounds.width : UIScreen.main.bounds.width }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.14) {
            index += next ? 1 : -1
            horizontalDrag = next ? UIScreen.main.bounds.width * 0.3 : -UIScreen.main.bounds.width * 0.3
            withAnimation(.snappy(duration: 0.24)) { horizontalDrag = 0 }
        }
    }
    private func markCurrentRead() async {
        guard !items[index].read else { return }
        let id = item.id
        do { try await APIClient(baseURL: baseURL).markNewsRead(id: id); items[index].read = true; readChanged(id) } catch { }
    }
    private func section(_ title: String, _ text: String) -> some View { VStack(alignment: .leading, spacing: 9) { Divider(); Text(title.uppercased()).font(.caption2.bold()).tracking(1.4).foregroundStyle(.secondary); Markdown(text).markdownTheme(.hyperChat).textSelection(.enabled) } }
    private func toggleLike() { items[index].liked.toggle(); let value = items[index]; likedChanged(value.id, value.liked); Task { _ = try? await APIClient(baseURL: baseURL).setNewsLiked(id: value.id, liked: value.liked) } }
}


private struct NewsAgentSheet: View {
    let baseURL: URL
    let item: NewsItem
    @Environment(\.dismiss) private var dismiss
    @State private var prompt = "Краткий пересказ"
    @State private var starting = false
    @State private var error: String?
    @FocusState private var focused: Bool

    var body: some View {
        NavigationStack {
            Form {
                Section("News") { Text(item.title).font(.callout.weight(.semibold)); Text(item.sourceLabel).font(.caption).foregroundStyle(.secondary) }
                Section("Agent task") {
                    TextField("What should the agent do?", text: $prompt, axis: .vertical).lineLimit(2...6).focused($focused)
                    Button { start() } label: { HStack { if starting { ProgressView().controlSize(.small) }; Label("Start agent", systemImage: "sparkles") } }.disabled(prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || starting)
                }
                if let error { Section { Label(error, systemImage: "exclamationmark.triangle").foregroundStyle(.red) } }
            }
            .navigationTitle("Start news agent")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
        .presentationDetents([.medium, .large])
        .task { focused = true }
    }

    private func start() {
        starting = true; error = nil
        Task { do { _ = try await APIClient(baseURL: baseURL).startNewsAgent(id: item.id, prompt: prompt); focused = false; dismiss() } catch { self.error = error.localizedDescription; starting = false } }
    }
}

struct NativePadNewsView: View {
    let baseURL: URL
    @Environment(\.dismiss) private var dismiss
    @State private var items: [NewsItem] = []
    @State private var selected: NewsItem?
    @State private var loading = true
    @State private var query = ""
    @State private var mode = "unread"
    @State private var stats = NewsStats(total: 0, unread: 0, liked: 0, sources: 0)
    private let columns = [GridItem(.adaptive(minimum: 280, maximum: 390), spacing: 16)]

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVGrid(columns: columns, spacing: 16) {
                    ForEach(items) { item in
                        Button { selected = item } label: { PadNewsCard(item: item) }.buttonStyle(.plain)
                    }
                }.padding(20)
            }
            .background(Color(.systemGroupedBackground))
            .overlay { if loading && items.isEmpty { ProgressView("Loading news…") } else if items.isEmpty { ContentUnavailableView("No stories", systemImage: "newspaper") } }
            .navigationTitle("News")
            .searchable(text: $query, prompt: "Search archive")
            .onSubmit(of: .search) { Task { await load() } }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } }
                ToolbarItem(placement: .principal) {
                    Picker("View", selection: $mode) {
                        Text("Unread \(stats.unread)").tag("unread")
                        Text("Archive \(stats.total)").tag("all")
                        Text("Liked \(stats.liked)").tag("liked")
                    }.pickerStyle(.segmented).frame(width: 360)
                }
            }
            .refreshable { await load() }
        }
        .fullScreenCover(item: $selected, onDismiss: { Task { await load() } }) { item in
            NavigationStack {
                NewsDetailView(baseURL: baseURL, items: items, initialID: item.id) { id, liked in if let i = items.firstIndex(where: { $0.id == id }) { items[i].liked = liked } }
                    .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { selected = nil } } }
            }
        }
        .onChange(of: mode) { _, _ in Task { await load() } }
        .task { await load() }
    }

    private func load() async {
        loading = true; defer { loading = false }
        do { let response = try await APIClient(baseURL: baseURL).news(view: mode, query: query); items = response.items; stats = response.stats } catch {}
    }
}

private struct PadNewsCard: View {
    let item: NewsItem
    var body: some View {
        VStack(alignment: .leading, spacing: 11) {
            if let raw = item.imageURL, let url = URL(string: raw) {
                AsyncImage(url: url) { phase in if let image = phase.image { image.resizable().scaledToFill() } else { Color(.secondarySystemBackground) } }
                    .frame(height: 150).frame(maxWidth: .infinity).clipped()
            }
            VStack(alignment: .leading, spacing: 9) {
                HStack { Text(item.sourceLabel).font(.caption.weight(.semibold)).foregroundStyle(.tint); Spacer(); if item.liked { Image(systemName: "heart.fill").foregroundStyle(.pink) }; if !item.read { Circle().fill(.tint).frame(width: 7, height: 7) } }
                Text(item.title).font(.title3.bold()).foregroundStyle(.primary).lineLimit(3).fixedSize(horizontal: false, vertical: true)
                if !item.summary.isEmpty { Text(item.summary).font(.subheadline).foregroundStyle(.secondary).lineLimit(3) }
                HStack { if let date = item.shownAt { Text(String(date.prefix(10))) }; Spacer(); if let points = item.points { Label("\(points)", systemImage: "arrow.up") }; if let comments = item.comments { Label("\(comments)", systemImage: "bubble.left") } }.font(.caption2).foregroundStyle(.tertiary)
            }.padding([.horizontal, .bottom], 15)
        }
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 17))
        .clipShape(RoundedRectangle(cornerRadius: 17))
        .overlay(RoundedRectangle(cornerRadius: 17).stroke(Color.primary.opacity(0.08), lineWidth: 0.5))
    }
}
