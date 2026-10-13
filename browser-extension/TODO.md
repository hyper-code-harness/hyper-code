# TODO

## Native Chrome Split View

- Add a `split-new-tab` extension command and bind it to Ctrl+S.
- Implement it with `chrome.tabs.create({ splitWithTabId: currentTab.id })`: keep the current tab on the left and open a new tab on the right in Chrome's native Split View.
- Require Chrome 155+ or detect support at runtime. Our current Chrome 154 exposes `Tab.splitViewId` but does not yet expose `splitWithTabId`, `chrome.tabs.createSplit()`, or `chrome.tabs.unsplit()`.
- Until Chrome 155 is installed, do not emulate this with resized OS windows. Optionally show a clear unsupported-version message.
- Add worker tests for: active tab selected, new tab split on the right, no active tab, and unsupported Chrome.

Reference: https://developer.chrome.com/blog/split-view-api-extensions?hl=en
