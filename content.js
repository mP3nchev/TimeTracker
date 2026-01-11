const ext = window.chrome || window.browser

let isPageFocused = true
let isPageVisible = true

document.addEventListener("visibilitychange", () => {
  isPageVisible = document.visibilityState === "visible"
})

window.addEventListener("focus", () => {
  isPageFocused = true
})

window.addEventListener("blur", () => {
  isPageFocused = false
})

ext.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getVisibility") {
    sendResponse({
      isVisible: isPageVisible,
      isFocused: isPageFocused,
    })
    return true
  }
  return false
})

window.hasContentScript = true
