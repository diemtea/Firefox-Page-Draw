let drawModeTabs = new Set();
let contextMenusCreated = false;

function createContextMenus() {
  const items = [
    { id: "undo",        title: "Undo" },
    { id: "redo",        title: "Redo" },
    { id: "clear",       title: "Clear Drawings" },
    { id: "changeColor", title: "Change Brush Color" },
    { id: "changeSize",  title: "Change Brush Size" }
  ];
  for (let {id, title} of items) {
    browser.contextMenus.create({ id, title, contexts: ["all"] });
  }
  contextMenusCreated = true;
}

function updateContextMenus() {
  if (drawModeTabs.size > 0) {
    if (!contextMenusCreated) createContextMenus();
  } else if (contextMenusCreated) {
    browser.contextMenus.removeAll();
    contextMenusCreated = false;
  }
}

browser.browserAction.onClicked.addListener(tab => {
  const tabId = tab.id;
  const enabling = !drawModeTabs.has(tabId);

  if (enabling) {
    drawModeTabs.add(tabId);
    browser.tabs.sendMessage(tabId, { type: "toggleDrawMode", enabled: true });
  } else {
    drawModeTabs.delete(tabId);
    browser.tabs.sendMessage(tabId, { type: "toggleDrawMode", enabled: false });
  }

  updateContextMenus();
});

browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading" && drawModeTabs.has(tabId)) {
    drawModeTabs.delete(tabId);
    updateContextMenus();
  }
});

browser.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab || !drawModeTabs.has(tab.id)) return;
  browser.tabs.sendMessage(tab.id, { type: info.menuItemId });
});

// Listen for the exitDrawMode message and remove the tab from drawModeTabs
browser.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type === "exitDrawMode" && sender.tab) {
    const tabId = sender.tab.id;
    if (drawModeTabs.has(tabId)) {
      drawModeTabs.delete(tabId);
      updateContextMenus();
    }
  }
});