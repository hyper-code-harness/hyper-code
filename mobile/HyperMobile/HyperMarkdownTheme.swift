import SwiftUI
import MarkdownUI

extension Theme {
    static let hyperChat = Theme()
        .text { ForegroundColor(.primary); FontSize(15) }
        .strong { FontWeight(.semibold) }
        .code { FontFamilyVariant(.monospaced); FontSize(.em(0.88)); ForegroundColor(.primary) }
        .link { ForegroundColor(.accentColor); UnderlineStyle(.single) }
        .heading1 { config in config.label.markdownTextStyle { FontWeight(.bold); FontSize(.em(1.55)) }.markdownMargin(top: 14, bottom: 8) }
        .heading2 { config in config.label.markdownTextStyle { FontWeight(.bold); FontSize(.em(1.32)) }.markdownMargin(top: 12, bottom: 7) }
        .heading3 { config in config.label.markdownTextStyle { FontWeight(.semibold); FontSize(.em(1.15)) }.markdownMargin(top: 10, bottom: 6) }
        .paragraph { config in config.label.fixedSize(horizontal: false, vertical: true).relativeLineSpacing(.em(0.18)).markdownMargin(top: 0, bottom: 9) }
        .codeBlock { config in
            ScrollView(.horizontal, showsIndicators: false) {
                config.label.fixedSize(horizontal: true, vertical: true)
                    .markdownTextStyle { FontFamilyVariant(.monospaced); FontSize(.em(0.84)); ForegroundColor(.primary) }
                    .padding(.vertical, 8)
            }
            .markdownMargin(top: 3, bottom: 10)
        }
        .blockquote { config in HStack(spacing: 8) { Rectangle().fill(Color.secondary.opacity(0.45)).frame(width: 2); config.label.markdownTextStyle { ForegroundColor(.secondary) } }.markdownMargin(top: 2, bottom: 9) }
        .listItem { config in config.label.markdownMargin(top: .em(0.12)) }
}
