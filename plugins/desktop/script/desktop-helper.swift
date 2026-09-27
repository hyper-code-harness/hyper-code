// desktop-helper: macOS Accessibility + CGEvent bridge for the Hyper desktop plugin.
// Usage: desktop-helper <command> [args...]; always prints one JSON object to stdout.
import Cocoa
import ApplicationServices

func out(_ v: Any) { let d = try! JSONSerialization.data(withJSONObject: v, options: [.sortedKeys]); FileHandle.standardOutput.write(d); print("") }
func fail(_ m: String) -> Never { out(["error": m]); exit(1) }

let args = Array(CommandLine.arguments.dropFirst())
guard let cmd = args.first else { fail("missing command") }

func attr(_ e: AXUIElement, _ a: String) -> AnyObject? { var v: AnyObject?; return AXUIElementCopyAttributeValue(e, a as CFString, &v) == .success ? v : nil }
func str(_ e: AXUIElement, _ a: String) -> String? {
  guard let v = attr(e, a) else { return nil }
  if let s = v as? String { return s.isEmpty ? nil : String(s.prefix(300)) }
  if let n = v as? NSNumber { return n.stringValue }
  return nil
}
func frame(_ e: AXUIElement) -> [String: Double]? {
  guard let p = attr(e, kAXPositionAttribute), let s = attr(e, kAXSizeAttribute) else { return nil }
  var pt = CGPoint.zero, sz = CGSize.zero
  AXValueGetValue(p as! AXValue, .cgPoint, &pt); AXValueGetValue(s as! AXValue, .cgSize, &sz)
  return ["x": Double(pt.x), "y": Double(pt.y), "w": Double(sz.width), "h": Double(sz.height)]
}
func children(_ e: AXUIElement) -> [AXUIElement] { (attr(e, kAXChildrenAttribute) as? [AXUIElement]) ?? [] }
func actions(_ e: AXUIElement) -> [String] { var n: CFArray?; AXUIElementCopyActionNames(e, &n); return (n as? [String]) ?? [] }

func findApp(_ q: String) -> NSRunningApplication {
  let apps = NSWorkspace.shared.runningApplications
  if let pid = Int32(q), let a = apps.first(where: { $0.processIdentifier == pid }) { return a }
  let l = q.lowercased()
  if let a = apps.first(where: { $0.localizedName?.lowercased() == l || $0.bundleIdentifier?.lowercased() == l }) { return a }
  if let a = apps.first(where: { $0.activationPolicy == .regular && ($0.localizedName?.lowercased().contains(l) ?? false) }) { return a }
  fail("app not found: \(q)")
}
func frontApp() -> NSRunningApplication { guard let a = NSWorkspace.shared.frontmostApplication else { fail("no frontmost app") }; return a }
func appEl(_ q: String?) -> (NSRunningApplication, AXUIElement) {
  let a = (q == nil || q == "" || q == "front") ? frontApp() : findApp(q!)
  let el = AXUIElementCreateApplication(a.processIdentifier)
  AXUIElementSetMessagingTimeout(el, 3)
  return (a, el)
}
// Root for element paths: "w<N>" = window N, "m" = menu bar, "f" = focused window.
func root(_ app: AXUIElement, _ head: String) -> AXUIElement {
  if head == "m" { if let m = attr(app, kAXMenuBarAttribute) { return (m as! AXUIElement) }; fail("no menu bar") }
  if head == "f" { if let w = attr(app, kAXFocusedWindowAttribute) { return (w as! AXUIElement) }; fail("no focused window") }
  if head == "a" { return app }
  if head.hasPrefix("w"), let i = Int(head.dropFirst()) {
    let ws = (attr(app, kAXWindowsAttribute) as? [AXUIElement]) ?? []
    if i < ws.count { return ws[i] }
  }
  fail("bad root \(head)")
}
func resolve(_ app: AXUIElement, _ path: String) -> AXUIElement {
  let parts = path.split(separator: ".").map(String.init)
  guard let h = parts.first else { fail("empty path") }
  var e = root(app, h)
  for p in parts.dropFirst() {
    guard let i = Int(p) else { fail("bad path segment \(p)") }
    let c = children(e); if i >= c.count { fail("path \(path) no longer exists; take a new snapshot") }
    e = c[i]
  }
  return e
}

var budget = 0
func walk(_ e: AXUIElement, _ id: String, _ depth: Int, _ maxDepth: Int) -> [String: Any] {
  budget -= 1
  var n: [String: Any] = ["id": id]
  if let r = str(e, kAXRoleAttribute) { n["role"] = r }
  if let v = str(e, kAXSubroleAttribute) { n["subrole"] = v }
  for (k, a) in [("title", kAXTitleAttribute), ("value", kAXValueAttribute), ("desc", kAXDescriptionAttribute), ("help", kAXHelpAttribute), ("placeholder", "AXPlaceholderValue"), ("identifier", "AXIdentifier")] {
    if let v = str(e, a) { n[k] = v }
  }
  if let f = frame(e) { n["frame"] = f }
  if let en = attr(e, kAXEnabledAttribute) as? Bool, !en { n["disabled"] = true }
  if let fo = attr(e, kAXFocusedAttribute) as? Bool, fo { n["focused"] = true }
  let acts = actions(e).filter { $0.hasPrefix("AX") && $0 != "AXShowMenu" && $0 != "AXScrollToVisible" && !$0.hasPrefix("AXScroll") }
  if !acts.isEmpty { n["actions"] = acts }
  if depth < maxDepth && budget > 0 {
    var kids: [[String: Any]] = []
    for (i, c) in children(e).enumerated() { if budget <= 0 { n["truncated"] = true; break }; kids.append(walk(c, "\(id).\(i)", depth + 1, maxDepth)) }
    if !kids.isEmpty { n["children"] = kids }
  } else if !children(e).isEmpty { n["truncated"] = true }
  return n
}

func post(_ e: CGEvent?) { e?.post(tap: .cghidEventTap) }
func mouse(_ x: Double, _ y: Double, _ button: String, _ count: Int) {
  let p = CGPoint(x: x, y: y)
  let (down, up, b): (CGEventType, CGEventType, CGMouseButton) = button == "right" ? (.rightMouseDown, .rightMouseUp, .right) : (.leftMouseDown, .leftMouseUp, .left)
  post(CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: p, mouseButton: b)); usleep(30000)
  for i in 1...max(1, count) {
    let d = CGEvent(mouseEventSource: nil, mouseType: down, mouseCursorPosition: p, mouseButton: b); d?.setIntegerValueField(.mouseEventClickState, value: Int64(i)); post(d)
    let u = CGEvent(mouseEventSource: nil, mouseType: up, mouseCursorPosition: p, mouseButton: b); u?.setIntegerValueField(.mouseEventClickState, value: Int64(i)); post(u)
    usleep(40000)
  }
}
let keyCodes: [String: CGKeyCode] = ["a":0,"s":1,"d":2,"f":3,"h":4,"g":5,"z":6,"x":7,"c":8,"v":9,"b":11,"q":12,"w":13,"e":14,"r":15,"y":16,"t":17,"1":18,"2":19,"3":20,"4":21,"6":22,"5":23,"=":24,"9":25,"7":26,"-":27,"8":28,"0":29,"]":30,"o":31,"u":32,"[":33,"i":34,"p":35,"return":36,"enter":36,"l":37,"j":38,"'":39,"k":40,";":41,"\\":42,",":43,"/":44,"n":45,"m":46,".":47,"tab":48,"space":49,"`":50,"delete":51,"backspace":51,"escape":53,"esc":53,"forwarddelete":117,"home":115,"end":119,"pageup":116,"pagedown":121,"left":123,"right":124,"down":125,"up":126,"f1":122,"f2":120,"f3":99,"f4":118,"f5":96,"f6":97,"f7":98,"f8":100,"f9":101,"f10":109,"f11":103,"f12":111]
func key(_ combo: String) {
  // A lone printable character without a US key code (*, +, ё, ...) is typed as Unicode.
  if combo.count == 1, keyCodes[combo.lowercased()] == nil { typeText(combo); return }
  var flags: CGEventFlags = []; var code: CGKeyCode? = nil
  for p in combo.lowercased().split(separator: "+").map(String.init) {
    switch p {
    case "cmd", "command": flags.insert(.maskCommand)
    case "shift": flags.insert(.maskShift)
    case "alt", "option", "opt": flags.insert(.maskAlternate)
    case "ctrl", "control": flags.insert(.maskControl)
    case "fn": flags.insert(.maskSecondaryFn)
    default: guard let k = keyCodes[p] else { fail("unknown key \(p)") }; code = k
    }
  }
  guard let c = code else { fail("no key in \(combo)") }
  let src = CGEventSource(stateID: .hidSystemState)
  let d = CGEvent(keyboardEventSource: src, virtualKey: c, keyDown: true); d?.flags = flags; post(d)
  let u = CGEvent(keyboardEventSource: src, virtualKey: c, keyDown: false); u?.flags = flags; post(u)
}
func typeText(_ s: String) {
  let src = CGEventSource(stateID: .hidSystemState)
  for ch in s {
    var u = Array(String(ch).utf16)
    let d = CGEvent(keyboardEventSource: src, virtualKey: 0, keyDown: true); d?.flags = []; d?.keyboardSetUnicodeString(stringLength: u.count, unicodeString: &u); post(d)
    let up = CGEvent(keyboardEventSource: src, virtualKey: 0, keyDown: false); up?.flags = []; up?.keyboardSetUnicodeString(stringLength: u.count, unicodeString: &u); post(up)
    usleep(12000)
  }
}

switch cmd {
case "check":
  if args.count > 1 && args[1] == "prompt" {
    _ = AXIsProcessTrustedWithOptions([kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary)
    _ = CGRequestScreenCaptureAccess()
  }
  let screens = NSScreen.screens.map { s -> [String: Double] in ["x": Double(s.frame.origin.x), "y": Double(s.frame.origin.y), "w": Double(s.frame.width), "h": Double(s.frame.height), "scale": Double(s.backingScaleFactor)] }
  out(["accessibility": AXIsProcessTrusted(), "screenRecording": CGPreflightScreenCaptureAccess(), "screens": screens])
case "apps":
  let front = NSWorkspace.shared.frontmostApplication?.processIdentifier
  out(["apps": NSWorkspace.shared.runningApplications.filter { $0.activationPolicy == .regular }.map { a -> [String: Any] in
    ["name": a.localizedName ?? "", "pid": Int(a.processIdentifier), "bundleId": a.bundleIdentifier ?? "", "active": a.processIdentifier == front, "hidden": a.isHidden] }])
case "windows":
  let (a, app) = appEl(args.count > 1 ? args[1] : nil)
  let ws = (attr(app, kAXWindowsAttribute) as? [AXUIElement]) ?? []
  out(["app": a.localizedName ?? "", "pid": Int(a.processIdentifier), "windows": ws.enumerated().map { (i, w) -> [String: Any] in
    var n: [String: Any] = ["id": "w\(i)", "title": str(w, kAXTitleAttribute) ?? ""]; if let f = frame(w) { n["frame"] = f }
    if let m = attr(w, kAXMinimizedAttribute) as? Bool { n["minimized"] = m }; return n }])
case "tree":
  // tree <app> <rootPath> <maxDepth> <maxNodes>
  let (a, app) = appEl(args.count > 1 ? args[1] : nil)
  let rp = args.count > 2 && args[2] != "" ? args[2] : "f"
  let md = args.count > 3 ? Int(args[3]) ?? 12 : 12
  budget = args.count > 4 ? Int(args[4]) ?? 400 : 400
  let e = resolve(app, rp)
  out(["app": a.localizedName ?? "", "pid": Int(a.processIdentifier), "tree": walk(e, rp, 0, md), "budgetExhausted": budget <= 0])
case "action":
  // action <app> <path> <AXAction>
  guard args.count > 3 else { fail("usage: action app path action") }
  let (_, app) = appEl(args[1]); let e = resolve(app, args[2])
  let r = AXUIElementPerformAction(e, args[3] as CFString)
  if r != .success { fail("AX action \(args[3]) failed: \(r.rawValue)") }
  out(["ok": true])
case "set":
  // set <app> <path> <value> [attribute]
  guard args.count > 3 else { fail("usage: set app path value") }
  let (_, app) = appEl(args[1]); let e = resolve(app, args[2])
  let a = args.count > 4 ? args[4] : kAXValueAttribute as String
  let v: CFTypeRef = a == kAXFocusedAttribute as String ? (args[3] == "true" ? kCFBooleanTrue : kCFBooleanFalse)! : args[3] as CFString
  let r = AXUIElementSetAttributeValue(e, a as CFString, v)
  if r != .success { fail("set \(a) failed: \(r.rawValue)") }
  out(["ok": true])
case "activate":
  guard args.count > 1 else { fail("usage: activate app") }
  let a = findApp(args[1])
  a.unhide(); let ok = a.activate(options: [.activateAllWindows])
  out(["ok": ok, "app": a.localizedName ?? "", "pid": Int(a.processIdentifier)])
case "click":
  guard args.count > 2, let x = Double(args[1]), let y = Double(args[2]) else { fail("usage: click x y [left|right] [count]") }
  mouse(x, y, args.count > 3 ? args[3] : "left", args.count > 4 ? Int(args[4]) ?? 1 : 1); out(["ok": true])
case "move":
  guard args.count > 2, let x = Double(args[1]), let y = Double(args[2]) else { fail("usage: move x y") }
  post(CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: CGPoint(x: x, y: y), mouseButton: .left)); out(["ok": true])
case "scroll":
  guard args.count > 2, let dy = Int32(args[1]), let dx = Int32(args[2]) else { fail("usage: scroll dy dx") }
  post(CGEvent(scrollWheelEvent2Source: nil, units: .line, wheelCount: 2, wheel1: dy, wheel2: dx, wheel3: 0)); out(["ok": true])
case "type":
  typeText(args.count > 1 ? args[1] : ""); out(["ok": true])
case "key":
  for c in args.dropFirst() { key(c); usleep(40000) }; out(["ok": true])
case "cursor":
  let p = CGEvent(source: nil)?.location ?? .zero; out(["x": Double(p.x), "y": Double(p.y)])
default:
  fail("unknown command \(cmd)")
}
