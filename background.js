// Service workers don't have access to window object
// Use chrome/browser APIs directly
const ext = (typeof chrome !== "undefined" && chrome.runtime) ? chrome : browser

const CONFIG = {
  CLEANUP_INTERVAL_MS: 3600000,
  DATA_RETENTION_DAYS: 60,
  CHECK_INTERVAL_MS: 1000,
  MIN_RECORD_SECONDS: 10,
  TRACKING_ALARM_NAME: "trackTime",
}

let tabAccumulatedTime = {}

startTracking()

ext.runtime.onInstalled.addListener(() => {
  cleanupOldData()
  startTracking()
})

ext.runtime.onStartup.addListener(() => {
  startTracking()
})

ext.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "cleanup") {
    cleanupOldData()
  } else if (alarm.name === CONFIG.TRACKING_ALARM_NAME) {
    trackActiveTab()
  }
})

async function startTracking() {
  // Create periodic alarm for tracking (every 1 second)
  // Note: Chrome alarms have minimum 1 minute for periodic, so we use delayInMinutes: 0
  // and reschedule after each execution for 1-second intervals
  ext.alarms.create(CONFIG.TRACKING_ALARM_NAME, { delayInMinutes: 0.0167 }) // ~1 second

  // Create cleanup alarm (every 60 minutes)
  ext.alarms.create("cleanup", { periodInMinutes: 60 })
}

async function trackActiveTab() {
  try {
    const [activeTab] = await ext.tabs.query({ active: true, lastFocusedWindow: true })

    if (!activeTab || !activeTab.id || !activeTab.title) {
      // Reschedule alarm
      ext.alarms.create(CONFIG.TRACKING_ALARM_NAME, { delayInMinutes: 0.0167 })
      return
    }

    if (
      activeTab.url.startsWith("chrome://") ||
      activeTab.url.startsWith("about:") ||
      activeTab.url.startsWith("edge://") ||
      activeTab.url.startsWith("chrome-extension://") ||
      activeTab.url.startsWith("moz-extension://")
    ) {
      // Reschedule alarm
      ext.alarms.create(CONFIG.TRACKING_ALARM_NAME, { delayInMinutes: 0.0167 })
      return
    }

    const tabId = activeTab.id
    if (!tabAccumulatedTime[tabId]) {
      tabAccumulatedTime[tabId] = {
        seconds: 0,
        tab: activeTab,
      }
    }

    tabAccumulatedTime[tabId].seconds += 1
    tabAccumulatedTime[tabId].tab = activeTab

    if (tabAccumulatedTime[tabId].seconds >= CONFIG.MIN_RECORD_SECONDS) {
      await recordSession(activeTab)
    }
  } catch (error) {
    console.error("[v0] Error in tracking:", error)
  }

  // Reschedule alarm for next check
  ext.alarms.create(CONFIG.TRACKING_ALARM_NAME, { delayInMinutes: 0.0167 })
}

ext.tabs.onActivated.addListener(() => {
  tabAccumulatedTime = {}
})

ext.tabs.onRemoved.addListener((tabId) => {
  delete tabAccumulatedTime[tabId]
})

async function recordSession(tab) {
  const db = new IndexedDBManager()
  const docKey = generateDocKey(tab)
  const today = new Date().toISOString().split("T")[0]

  await db.recordSession({
    docKey,
    title: tab.title,
    date: today,
    durationMs: 1000,
    url: tab.url,
  })
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

  // Claude.ai chat tracking by conversation ID
  if (url.hostname.includes("claude.ai")) {
    const match = url.pathname.match(/\/chat\/([a-zA-Z0-9-_]+)/)
    if (match) return `claude_${match[1]}`
  }

  // ChatGPT tracking by conversation ID
  if (url.hostname.includes("chat.openai.com") || url.hostname.includes("chatgpt.com")) {
    const match = url.pathname.match(/\/c\/([a-zA-Z0-9-_]+)/)
    if (match) return `chatgpt_${match[1]}`
  }

  return `domain_${url.hostname}`
}

async function cleanupOldData() {
  const db = new IndexedDBManager()
  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - CONFIG.DATA_RETENTION_DAYS)
  const cutoffString = cutoffDate.toISOString().split("T")[0]

  await db.deleteOldSessions(cutoffString)
}

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

  async recordSession({ docKey, title, date, durationMs, url }) {
    if (!this.db) await this.init()

    const transaction = this.db.transaction(["documents", "sessions"], "readwrite")
    const docStore = transaction.objectStore("documents")
    const sessionStore = transaction.objectStore("sessions")
    const docRequest = docStore.get(docKey)

    return new Promise((resolve, reject) => {
      docRequest.onsuccess = () => {
        const docRecord = docRequest.result || {
          docKey,
          title,
          url,
          firstSeen: new Date().toISOString(),
          lastSeen: new Date().toISOString(),
          totalTimeMs: 0,
        }

        docRecord.title = title
        docRecord.lastSeen = new Date().toISOString()
        docRecord.totalTimeMs += durationMs

        docStore.put(docRecord)

        sessionStore.add({
          docKey,
          date,
          durationMs,
          timestamp: new Date().toISOString(),
        })

        transaction.oncomplete = () => resolve()
        transaction.onerror = () => reject(transaction.error)
      }

      docRequest.onerror = () => reject(docRequest.error)
    })
  }

  async getAllDocuments() {
    if (!this.db) await this.init()

    return new Promise((resolve, reject) => {
      const request = this.db.transaction("documents", "readonly").objectStore("documents").getAll()
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
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

  async getTimeBreakdown(docKey, period = "day") {
    const sessions = await this.getSessionsByDocKey(docKey)
    const breakdown = {}

    sessions.forEach((session) => {
      let key = session.date
      if (period === "week") {
        key = this.getWeekKey(session.date)
      } else if (period === "month") {
        key = session.date.substring(0, 7)
      }

      if (!breakdown[key]) breakdown[key] = 0
      breakdown[key] += session.durationMs
    })

    return breakdown
  }

  getWeekKey(dateString) {
    const date = new Date(dateString)
    const firstDay = new Date(date.setDate(date.getDate() - date.getDay()))
    return firstDay.toISOString().split("T")[0]
  }

  async deleteOldSessions(cutoffDate) {
    if (!this.db) await this.init()

    return new Promise((resolve, reject) => {
      const range = IDBKeyRange.upperBound(cutoffDate)
      const index = this.db.transaction("sessions", "readwrite").objectStore("sessions").index("date")
      const request = index.openCursor(range)

      request.onsuccess = (event) => {
        const cursor = event.target.result
        if (cursor) {
          cursor.delete()
          cursor.continue()
        } else {
          resolve()
        }
      }

      request.onerror = () => reject(request.error)
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
