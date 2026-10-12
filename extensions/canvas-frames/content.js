// Runs in Hyper pages: tells the page the extension is here (the canvas then frames sites that forbid
// it instead of showing a notice) and asks the worker to lift the framing headers for this tab's frames.
document.documentElement.setAttribute('data-hyper-frames', '1');
chrome.runtime.sendMessage({ type: 'hyper-canvas-tab' }).catch(() => {});
