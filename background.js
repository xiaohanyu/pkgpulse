// Injects inject.js into the active tab on every toolbar-icon click; the
// injected script itself handles the show/hide toggling.
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return
  // An earlier click on an unscriptable page may still have its "!" up: the
  // worker can be evicted before the timeout that clears it ever fires.
  chrome.action.setBadgeText({ tabId: tab.id, text: '' }).catch(() => {})
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['inject.js'],
    })
  } catch {
    // Not scriptable (chrome:// pages, the Web Store, other extensions' pages)
    // — flag it on the icon, since nothing can be shown on the page itself.
    flashBadge(tab.id)
  }
})

/** Briefly show a "!" badge on the toolbar icon for this tab. */
async function flashBadge(tabId) {
  try {
    await chrome.action.setBadgeBackgroundColor({ tabId, color: '#cf222e' })
    await chrome.action.setBadgeText({ tabId, text: '!' })
    setTimeout(() => {
      chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {})
    }, 2500)
  } catch {
    /* tab may be gone — nothing to flag */
  }
}
