// Commands API allows only four commands. Page-level Ctrl-P and Ctrl-X live
// here; never steal Ctrl-X from an editable field where it may mean Cut.
document.addEventListener('keydown', event => {
  if (!event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.repeat) return;
  const key = event.key.toLowerCase();
  const editable = event.target?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(event.target?.tagName || '');
  if (key === 'p') {
    event.preventDefault(); event.stopImmediatePropagation();
    chrome.runtime.sendMessage({type: 'paletteOpen'});
  } else if (key === 'x' && !editable) {
    event.preventDefault(); event.stopImmediatePropagation();
    chrome.runtime.sendMessage({type: 'closeCurrent'});
  }
}, true);
