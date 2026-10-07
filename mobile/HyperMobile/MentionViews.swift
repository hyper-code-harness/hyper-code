import SwiftUI

struct MentionAvatar: View {
    let person: MentionPerson

    var body: some View {
        Group {
            if let picture = person.picture, let url = URL(string: picture), url.scheme == "https" {
                AuthenticatedRemoteImage(url: url) { image, _ in
                    if let image { Image(uiImage: image).resizable().scaledToFill() }
                    else { fallback }
                }
            } else {
                fallback
            }
        }
        .frame(width: 30, height: 30)
        .clipShape(Circle())
        .accessibilityHidden(true)
    }

    private var fallback: some View {
        Text(String((person.name.isEmpty ? person.id : person.name).prefix(1)).uppercased())
            .font(.caption.weight(.bold))
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color.accentColor.gradient)
    }
}
