const ext = window.chrome || window.browser

class IndexedDBManager {
  constructor(dbName = "DocTimeTrackerDB", version = 1) {
    this.dbName = dbName
    this.version = version
    this.db = null
  }

  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version)

      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        this.db = request.result
        resolve(this.db)
      }

      request.onupgradeneeded = (event) => {
        const db = event.target.result
        if (!db.objectStoreNames.contains("documents")) {
          const docStore = db.createObjectStore("documents", { keyPath: "docKey" })
          docStore.createIndex("lastSeen", "lastSeen", { unique: false })
        }
        if (!db.objectStoreNames.contains("sessions")) {
          const sessionStore = db.createObjectStore("sessions", { keyPath: "id", autoIncrement: true })
          sessionStore.createIndex("docKey", "docKey", { unique: false })
          sessionStore.createIndex("date", "date", { unique: false })
        }
      }
    })
  }

  async getDocumentStats(docKey) {
    if (!this.db) await this.init()
    return new Promise((resolve, reject) => {
      const request = this.db.transaction("documents", "readonly").objectStore("documents").get(docKey)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }

  async getTimeBreakdown(docKey, period = "day") {
    const sessions = await this.getSessionsByDocKey(docKey)
    const breakdown = {}
    sessions.forEach((session) => {
      const key = session.date
      if (!breakdown[key]) breakdown[key] = 0
      breakdown[key] += session.durationMs
    })
    return breakdown
  }

  async getSessionsByDocKey(docKey) {
    if (!this.db) await this.init()
    return new Promise((resolve, reject) => {
      const index = this.db.transaction("sessions", "readonly").objectStore("sessions").index("docKey")
      const request = index.getAll(docKey)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }

  formatTime(ms) {
    const seconds = Math.floor(ms / 1000)
    const minutes = Math.floor(seconds / 60)
    const hours = Math.floor(minutes / 60)
    const days = Math.floor(hours / 24)
    if (days > 0) return `${days}d ${hours % 24}h`
    if (hours > 0) return `${hours}h ${minutes % 60}m`
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`
    return `${seconds}s`
  }
}

async function updatePopup() {
  try {
    const tabs = await ext.tabs.query({ active: true, currentWindow: true })
    const currentTab = tabs[0]

    if (!currentTab || !currentTab.title) {
      document.getElementById("docTitle").textContent = "No document"
      document.getElementById("statusBadge").textContent = "Inactive"
      document.getElementById("statusBadge").classList.remove("active")
      return
    }

    const db = new IndexedDBManager()
    await db.init()

    const docKey = generateDocKey(currentTab)
    const stats = await db.getDocumentStats(docKey)
    const today = new Date().toISOString().split("T")[0]
    const todayBreakdown = await db.getTimeBreakdown(docKey, "day")
    const todayTime = todayBreakdown[today] || 0

    document.getElementById("docTitle").textContent = currentTab.title || "Untitled"
    document.getElementById("timeValue").textContent = db.formatTime(todayTime)

    if (stats) {
      document.getElementById("totalTime").textContent = db.formatTime(stats.totalTimeMs)
      document.getElementById("lastSeen").textContent = formatDate(stats.lastSeen)

      const lastSeenDate = new Date(stats.lastSeen)
      const now = new Date()
      const diffSeconds = (now - lastSeenDate) / 1000

      const statusBadge = document.getElementById("statusBadge")
      if (diffSeconds < 5) {
        statusBadge.classList.add("active")
        statusBadge.textContent = "Active"
      } else {
        statusBadge.classList.remove("active")
        statusBadge.textContent = "Inactive"
      }
    } else {
      document.getElementById("statusBadge").textContent = "Inactive"
      document.getElementById("statusBadge").classList.remove("active")
    }
  } catch (error) {
    console.error("[v0] Error updating popup:", error)
  }
}

function generateDocKey(tab) {
  const url = new URL(tab.url)

  if (url.hostname.includes("docs.google.com")) {
    const match = url.pathname.match(/\/document\/d\/([a-zA-Z0-9-_]+)/)
    if (match) return `gdoc_${match[1]}`
  }

  if (url.hostname.includes("docs.google.com") && url.pathname.includes("/spreadsheets")) {
    const match = url.pathname.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)
    if (match) return `gsheet_${match[1]}`
  }

  if (url.hostname.includes("office.com") || url.hostname.includes("office365.com")) {
    const match = url.pathname.match(/\/([a-z]+)\/([a-z0-9]+)/)
    if (match) return `office_${match[1]}_${match[2]}`
  }

  return `domain_${url.hostname}`
}

function formatDate(isoString) {
  if (!isoString) return "Never"
  const date = new Date(isoString)
  const now = new Date()
  const diffMs = now - date
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return "Just now"
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  return `${diffDays}d ago`
}

document.addEventListener("DOMContentLoaded", updatePopup)
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    updatePopup()
  }
})

setInterval(updatePopup, 5000)

document.getElementById("dashboardBtn").addEventListener("click", () => {
  const dashboardUrl = ext.runtime.getURL("dashboard/index.html")
  ext.tabs.create({ url: dashboardUrl })
})
