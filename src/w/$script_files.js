// Files picked in the browser before they are sent — shared by the chat's message box (agent/chat.js) and the
// to-do list (w/todo.js), so a file looks and behaves the same wherever it is attached.
(() => {
    if (window.hyperFiles) return;
    window.hyperFiles = {
        /** Files carried by a paste (a screenshot, a copied file). */
        fromPaste(event) {
            return [...(event.clipboardData?.items || [])].filter(item => item.kind === 'file').map(item => item.getAsFile()).filter(Boolean);
        },
        /** Whether a drag carries files from outside the page. */
        dragged(event) {
            return [...(event.dataTransfer?.types || [])].includes('Files');
        },
        /** The chip of one picked file (w-composer-file): a thumbnail or a file icon, its name, a button that drops it. */
        chip(file, onRemove) {
            const chip = document.createElement('div');
            chip.className = 'w-composer-file';
            if (file.type.startsWith('image/')) {
                const img = document.createElement('img'); img.src = URL.createObjectURL(file); img.onload = () => URL.revokeObjectURL(img.src); chip.append(img);
            } else { const icon = document.createElement('i'); icon.className = 'w-icon ph ph-file'; icon.dataset.size = '16'; chip.append(icon); }
            const name = document.createElement('span'); name.textContent = file.name; chip.append(name);
            const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'w-icon-button'; remove.dataset.size = '24'; remove.setAttribute('aria-label', 'Remove ' + file.name); remove.innerHTML = '<i class="w-icon ph ph-x" data-size="14" aria-hidden="true"></i>';
            remove.addEventListener('click', () => onRemove?.());
            chip.append(remove);
            return chip;
        },
    };
})();
