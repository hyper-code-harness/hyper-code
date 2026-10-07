import SwiftUI
import PhotosUI
import UniformTypeIdentifiers

struct AttachmentComposer: View {
    @Binding var text: String
    let baseURL: URL
    @Binding var attachments: [PendingAttachment]
    var focused: FocusState<Bool>.Binding
    let resetID: UUID
    let sending: Bool, running: Bool
    let injectText: String
    let injectEvery: Int
    let send: () -> Void, stop: () -> Void
    @State private var photoItems: [PhotosPickerItem] = []
    @State private var showingFiles = false
    @State private var showingPhotos = false
    @State private var showingCamera = false
    @State private var importError: String?

    @State private var mentionPeople: [MentionPerson] = []
    @State private var mentionResults: [MentionPerson] = []
    @State private var mentionStart: String.Index?
    @State private var loadingMentionPeople = false
    private var canSend: Bool { (!text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !attachments.isEmpty) && !sending }

    var body: some View {
        VStack(spacing: 7) {
            if !mentionResults.isEmpty {
                VStack(spacing: 0) {
                    ForEach(mentionResults) { person in
                        Button { insertMention(person) } label: {
                            HStack(spacing: 10) {
                                MentionAvatar(person: person)
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(person.name).font(.subheadline.weight(.semibold)).lineLimit(1)
                                    Text("@\(person.id)\(person.email.map { " · \($0)" } ?? "")")
                                        .font(.caption).foregroundStyle(.secondary).lineLimit(1)
                                }
                                Spacer(minLength: 0)
                            }
                            .padding(.horizontal, 12).padding(.vertical, 8)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        if person.id != mentionResults.last?.id { Divider().padding(.leading, 48) }
                    }
                }
                .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 14))
                .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color.primary.opacity(0.08)))
                .padding(.horizontal, 10)
                .accessibilityLabel("Mention someone")
            }

            if !attachments.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(attachments) { attachment in
                            HStack(spacing: 6) {
                                if attachment.isImage, let image = UIImage(data: attachment.data) { Image(uiImage: image).resizable().scaledToFill().frame(width: 32, height: 32).clipShape(RoundedRectangle(cornerRadius: 7)) }
                                else { Image(systemName: "doc.fill").foregroundStyle(.secondary) }
                                Text(attachment.name).font(.caption).lineLimit(1).frame(maxWidth: 120)
                                Button { attachments.removeAll { $0.id == attachment.id } } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary) }
                            }.padding(6).background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 11))
                        }
                    }.padding(.horizontal, 10)
                }
            }
            HStack(alignment: .bottom, spacing: 8) {
                Menu {
                    Button { showingCamera = true } label: { Label("Take photo", systemImage: "camera") }
                        .disabled(!UIImagePickerController.isSourceTypeAvailable(.camera))
                    Button { showingPhotos = true } label: { Label("Photo library", systemImage: "photo.on.rectangle") }
                    Button { showingFiles = true } label: { Label("Choose file", systemImage: "folder") }
                } label: {
                    Image(systemName: "plus").font(.headline).frame(width: 40, height: 40).background(Color(.secondarySystemGroupedBackground), in: Circle())
                }.accessibilityLabel("Add attachment")
                TextField("Message agent…", text: $text, axis: .vertical).id(resetID).lineLimit(1...6).focused(focused).padding(.horizontal, 13).padding(.vertical, 11).background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 20))
                if running {
                    Button(action: stop) {
                        Circle().fill(Color(.secondarySystemBackground)).frame(width: 44, height: 44)
                            .overlay(Image(systemName: "stop.fill").font(.callout.weight(.semibold)).foregroundStyle(.primary))
                            .overlay(Circle().stroke(Color.primary.opacity(0.12), lineWidth: 0.5))
                    }.accessibilityLabel("Stop agent")
                }
                Button(action: send) { Circle().fill(canSend ? Color.accentColor : Color.secondary.opacity(0.35)).frame(width: 44, height: 44).overlay { if sending { ProgressView().tint(.white) } else { Image(systemName: "arrow.up").font(.headline.bold()).foregroundStyle(.white) } } }.disabled(!canSend)
            }.padding(.horizontal, 10)
            if !injectText.isEmpty {
                Text("↳ \(injectText)\(injectEvery > 1 ? " · every \(injectEvery) turns" : "")")
                    .font(.system(size: 9.5)).foregroundStyle(.secondary).lineLimit(1)
                    .frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 58)
                    .accessibilityLabel("Prompt inject: \(injectText)")
            }
            if let importError { Text(importError).font(.caption2).foregroundStyle(.red).padding(.horizontal) }
        }
        .padding(.vertical, 8).background(.bar)
        .onChange(of: photoItems) { _, items in Task { await loadPhotos(items) } }
        .onChange(of: text) { _, _ in updateMentionSuggestions() }
        .photosPicker(isPresented: $showingPhotos, selection: $photoItems, maxSelectionCount: max(1, 10 - attachments.count), matching: .images)
        .fullScreenCover(isPresented: $showingCamera) {
            CameraPicker { result in
                switch result {
                case .success(let attachment): if attachment.data.count <= 25 * 1024 * 1024 { attachments.append(attachment) } else { importError = "Photo must be at most 25 MB" }
                case .failure(let error): importError = error.localizedDescription
                }
            }.ignoresSafeArea()
        }
        .fileImporter(isPresented: $showingFiles, allowedContentTypes: [.item], allowsMultipleSelection: true) { result in loadFiles(result) }
    }


    private func mentionQuery() -> (start: String.Index, query: String)? {
        guard let regex = try? NSRegularExpression(pattern: #"(^|[^\w@.\/-])@([a-z0-9-]{0,64})$"#, options: [.caseInsensitive]) else { return nil }
        let ns = text as NSString
        guard let match = regex.firstMatch(in: text, range: NSRange(location: 0, length: ns.length)) else { return nil }
        let range = match.range(at: 2)
        guard range.location != NSNotFound, let swiftRange = Range(range, in: text),
              let at = text.index(swiftRange.lowerBound, offsetBy: -1, limitedBy: text.startIndex) else { return nil }
        return (at, String(text[swiftRange]).lowercased())
    }



    private func updateMentionSuggestions() {
        guard let mention = mentionQuery() else { mentionStart = nil; mentionResults = []; return }
        mentionStart = mention.start
        if mentionPeople.isEmpty && !loadingMentionPeople {
            loadingMentionPeople = true
            Task {
                mentionPeople = (try? await APIClient(baseURL: baseURL).mentionPeople()) ?? []
                loadingMentionPeople = false
                updateMentionSuggestions()
            }
            return
        }
        let query = mention.query
        mentionResults = mentionPeople.filter { person in
            guard !query.isEmpty else { return true }
            let words = [person.id, person.name, person.email ?? ""]
                .joined(separator: " ").lowercased().split(whereSeparator: { " @.-".contains($0) })
            return person.id.lowercased().hasPrefix(query) || words.contains(where: { $0.hasPrefix(query) })
        }.prefix(8).map { $0 }
    }

    private func insertMention(_ person: MentionPerson) {
        guard let start = mentionStart else { return }
        text.replaceSubrange(start..<text.endIndex, with: "@\(person.id) ")
        mentionStart = nil
        mentionResults = []
        focused.wrappedValue = true
    }

    private func loadPhotos(_ items: [PhotosPickerItem]) async {
        for item in items.prefix(max(0, 10 - attachments.count)) {
            guard let data = try? await item.loadTransferable(type: Data.self), data.count <= 25 * 1024 * 1024 else { importError = "Each attachment must be at most 25 MB"; continue }
            let type = item.supportedContentTypes.first?.preferredMIMEType ?? "image/jpeg"
            let ext = item.supportedContentTypes.first?.preferredFilenameExtension ?? "jpg"
            attachments.append(.init(id: UUID(), name: "photo-\(attachments.count + 1).\(ext)", contentType: type, data: data))
        }
        photoItems = []
    }

    private func loadFiles(_ result: Result<[URL], Error>) {
        do {
            for url in try result.get().prefix(max(0, 10 - attachments.count)) {
                let access = url.startAccessingSecurityScopedResource(); defer { if access { url.stopAccessingSecurityScopedResource() } }
                let data = try Data(contentsOf: url); guard data.count <= 25 * 1024 * 1024 else { throw NSError(domain: "Hyper", code: 1, userInfo: [NSLocalizedDescriptionKey: "Each attachment must be at most 25 MB"]) }
                let type = (try? url.resourceValues(forKeys: [.contentTypeKey]).contentType?.preferredMIMEType) ?? "application/octet-stream"
                attachments.append(.init(id: UUID(), name: url.lastPathComponent, contentType: type, data: data))
            }
        } catch { importError = error.localizedDescription }
    }
}
