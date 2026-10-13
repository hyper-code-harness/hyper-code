const input = document.querySelector('input'), list = document.querySelector('ul');
let tabs = [], shown = [], selected = 0;
const draw = () => {
  const q = input.value.toLowerCase().trim();
  shown = tabs.filter(t => !q || `${t.title} ${t.url}`.toLowerCase().includes(q));
  selected = Math.max(0, Math.min(selected, shown.length - 1));
  list.replaceChildren(...shown.map((t, i) => {
    const li = document.createElement('li'); li.className = i === selected ? 'sel' : '';
    const title = document.createElement('span'); title.textContent = t.title || 'Untitled';
    const url = document.createElement('small'); url.textContent = t.url || '';
    li.append(title, url); li.onmouseenter = () => { selected = i; draw(); }; li.onclick = choose;
    return li;
  }));
  list.children[selected]?.scrollIntoView({block: 'nearest'});
};
function choose() { const tab = shown[selected]; if (tab) chrome.runtime.sendMessage({type: 'paletteActivate', tabId: tab.id}); window.close(); }
input.oninput = () => { selected = 0; draw(); };
input.onkeydown = event => {
  const key = event.key.toLowerCase(), n = Math.max(1, shown.length);
  if (event.key === 'Escape') { event.preventDefault(); window.close(); }
  else if (event.key === 'ArrowDown' || ((event.ctrlKey || event.metaKey) && key === 'j')) { event.preventDefault(); selected = (selected + 1) % n; draw(); }
  else if (event.key === 'ArrowUp' || ((event.ctrlKey || event.metaKey) && key === 'k')) { event.preventDefault(); selected = (selected - 1 + n) % n; draw(); }
  else if (event.key === 'Enter') { event.preventDefault(); choose(); }
};
chrome.runtime.sendMessage({type: 'paletteTabs'}, response => {
  if (!response?.ok) { document.body.textContent = response?.error || 'Cannot read tabs'; return; }
  tabs = response.tabs; selected = Math.max(0, tabs.findIndex(t => t.active)); draw(); input.focus();
});
