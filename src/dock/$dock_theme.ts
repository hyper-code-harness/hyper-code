// Light/dark switch. The theme itself is applied before first paint by the page head; this only flips it.
export default {
    label: "Theme",
    zone: "top",
    order: 10,
    render: (ctx: Context) => ctx.fns.procs.ui.button({ action: "toggle-theme", html: '<i class="ph ph-moon" aria-hidden="true"></i>', appearance: "plain", title: "Switch color theme", ariaLabel: "Switch color theme", class: "flex size-7 items-center justify-center rounded-md text-subtle hover:bg-base-300 hover:text-base-content", attrs: { id: "theme-toggle", "aria-pressed": "false" } })
        + `<script>(function(){var button=document.getElementById('theme-toggle');if(!button)return;function paint(){var dark=document.documentElement.dataset.theme==='dark';button.setAttribute('aria-pressed',String(dark));button.title=dark?'Use light theme':'Use dark theme';button.querySelector('i').className='ph '+(dark?'ph-sun':'ph-moon')}paint();button.addEventListener('click',function(){var next=document.documentElement.dataset.theme==='dark'?'light':'dark';document.documentElement.dataset.theme=next;document.documentElement.style.colorScheme=next;try{localStorage.setItem('hyper-theme',next)}catch(_){}paint()})})()</script>`,
} satisfies types.dock.Item;
