import SwiftUI

struct ContentView: View {
    @AppStorage("hyper.serverURL") private var serverURL = ""
    @State private var showingSettings = false
    @State private var reloadID = UUID()
    @State private var isLoading = true
    @State private var canGoBack = false
    @State private var canGoForward = false
    @State private var navigationCommand: WebNavigationCommand?

    var body: some View {
        VStack(spacing: 0) {
            ZStack(alignment: .topTrailing) {
                HyperWebView(
                    urlString: serverURL,
                    command: navigationCommand,
                    isLoading: $isLoading,
                    canGoBack: $canGoBack,
                    canGoForward: $canGoForward
                )
                .id(reloadID)

                if isLoading {
                    ProgressView()
                        .controlSize(.small)
                        .padding(11)
                        .background(.ultraThinMaterial, in: Circle())
                        .padding(8)
                }
            }

            HStack(spacing: 28) {
                navButton("chevron.backward", enabled: canGoBack) { send(.back) }
                navButton("chevron.forward", enabled: canGoForward) { send(.forward) }
                navButton("arrow.clockwise", enabled: true) { send(.reload) }
                Spacer()
                Button { showingSettings = true } label: {
                    Image(systemName: "gearshape")
                }
                .accessibilityLabel("Hyper server settings")
            }
            .font(.system(size: 17, weight: .semibold))
            .padding(.horizontal, 22)
            .frame(height: 48)
            .background(.bar)
        }
        .ignoresSafeArea(.container, edges: .bottom)
        .sheet(isPresented: $showingSettings) {
            ServerSettingsView(serverURL: $serverURL) {
                reloadID = UUID()
                showingSettings = false
            }
        }
    }

    private func navButton(_ systemName: String, enabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) { Image(systemName: systemName).frame(width: 24, height: 24) }
            .disabled(!enabled)
    }

    private func send(_ action: WebNavigationAction) {
        navigationCommand = WebNavigationCommand(action: action)
    }
}

private struct ServerSettingsView: View {
    @Binding var serverURL: String
    let connect: () -> Void
    @State private var draft: String
    @Environment(\.dismiss) private var dismiss

    init(serverURL: Binding<String>, connect: @escaping () -> Void) {
        _serverURL = serverURL
        self.connect = connect
        _draft = State(initialValue: serverURL.wrappedValue)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Hyper server") {
                    TextField("https://hyper.<team>.in.hn.hyper-mesh.xyz", text: $draft)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)
                }
                Section {
                    Button("Connect") {
                        serverURL = draft.trimmingCharacters(in: .whitespacesAndNewlines)
                        connect()
                    }
                    .disabled(URL(string: draft)?.scheme == nil)
                } footer: {
                    Text("Use localhost in Simulator. On a physical iPhone, enter the Mac’s LAN address or an HTTPS Hyper URL.")
                }
            }
            .navigationTitle("Connection")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
            }
        }
        .presentationDetents([.medium])
    }
}
