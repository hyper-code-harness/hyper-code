export default {
    type: "json",
    title: "Chat layout",
    description: "Order and hiding of the chat header parts: {\"badges\": [ids], \"buttons\": [ids], \"cards\": [ids], \"hidden\": [ids]}. Ids are <module>.<name> of $chatbadge_ (left of the header), $chatbutton_ (right) and $chatcard_ (cards of the ⋯ panel) files, e.g. agent.workspace, canvas.toggle, chat.team. Listed ids come first in that order, the rest follow by their declared order; unknown ids are skipped. The icon, the name and the danger card (Archive, Delete) cannot be hidden. Usually set for the instance in ~/.hyper/settings/$settings_chat.json.",
};
