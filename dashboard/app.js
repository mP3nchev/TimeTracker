const ext = typeof window.chrome !== "undefined" ? window.chrome : window.browser

let currentPeriod = "today"
let currentSort = "time-desc"
let allDocuments = []

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
      if (period === "week") key = this.getWeekKey(session.date)
      else if (period === "month") key = session.date.substring(0, 7)
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

document.addEventListener("DOMContentLoaded", async () => {
  await loadDocuments()
  setupEventListeners()
})

function setupEventListeners() {
  document.querySelectorAll(".filter-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      document.querySelectorAll(".filter-btn").forEach((b) => b.classList.remove("active"))
      e.target.classList.add("active")
      currentPeriod = e.target.dataset.period
      await loadDocuments()
    })
  })

  document.getElementById("sortBy").addEventListener("change", (e) => {
    currentSort = e.target.value
    renderTable()
  })

  document.getElementById("refreshBtn").addEventListener("click", async () => {
    await loadDocuments()
  })

  document.getElementById("exportBtn").addEventListener("click", exportData)
}

async function loadDocuments() {
  const db = new IndexedDBManager()
  await db.init()

  allDocuments = await db.getAllDocuments()

  if (currentPeriod !== "all") {
    allDocuments = filterByPeriod(allDocuments, currentPeriod)
  }

  renderTable()
  updateStats()
  renderBreakdown()
}

function filterByPeriod(docs, period) {
  const now = new Date()
  const cutoffDate = new Date()

  if (period === "today") {
    cutoffDate.setHours(0, 0, 0, 0)
  } else if (period === "week") {
    const dayOfWeek = now.getDay()
    cutoffDate.setDate(now.getDate() - dayOfWeek)
    cutoffDate.setHours(0, 0, 0, 0)
  } else if (period === "month") {
    cutoffDate.setDate(1)
    cutoffDate.setHours(0, 0, 0, 0)
  }

  const cutoffString = cutoffDate.toISOString().split("T")[0]
  return docs.filter((doc) => {
    const lastSeen = new Date(doc.lastSeen)
    const lastSeenString = lastSeen.toISOString().split("T")[0]
    return lastSeenString >= cutoffString
  })
}

function getSortedDocuments() {
  const sorted = [...allDocuments]
  switch (currentSort) {
    case "time-desc":
      sorted.sort((a, b) => b.totalTimeMs - a.totalTimeMs)
      break
    case "time-asc":
      sorted.sort((a, b) => a.totalTimeMs - b.totalTimeMs)
      break
    case "recent":
      sorted.sort((a, b) => new Date(b.lastSeen) - new Date(a.lastSeen))
      break
    case "name":
      sorted.sort((a, b) => a.title.localeCompare(b.title))
      break
  }
  return sorted
}

function renderTable() {
  const tbody = document.getElementById("documentsTable")
  const sorted = getSortedDocuments()

  if (sorted.length === 0) {
    tbody.innerHTML =
      '<tr class="empty-row"><td colspan="5" class="text-center">No documents found for this period</td></tr>'
    return
  }

  const db = new IndexedDBManager()
  tbody.innerHTML = sorted
    .map(
      (doc) =>
        `<tr>
      <td><div class="doc-name" title="${doc.title}">${doc.title}</div></td>
      <td><span class="time-value">${db.formatTime(doc.totalTimeMs)}</span></td>
      <td>${formatDate(doc.lastSeen)}</td>
      <td>
        <button class="btn-delete" data-dockey="${doc.docKey}">✕</button>
        <button class="btn-small" data-dockey="${doc.docKey}" data-action="view">View</button>
      </td>
    </tr>`,
    )
    .join("")

  document.querySelectorAll(".btn-delete").forEach((btn) => {
    btn.addEventListener("click", () => deleteDocument(btn.dataset.dockey))
  })

  document.querySelectorAll('.btn-small[data-action="view"]').forEach((btn) => {
    btn.addEventListener("click", () => viewDetails(btn.dataset.dockey))
  })
}

async function updateStats() {
  const db = new IndexedDBManager()
  const totalTime = allDocuments.reduce((sum, doc) => sum + doc.totalTimeMs, 0)
  const avgTime = allDocuments.length > 0 ? totalTime / allDocuments.length : 0

  document.getElementById("totalTimeStat").textContent = db.formatTime(totalTime)
  document.getElementById("docCountStat").textContent = allDocuments.length
  document.getElementById("avgTimeStat").textContent = db.formatTime(avgTime)
}

async function renderBreakdown() {
  if (allDocuments.length === 0) {
    document.getElementById("breakdownContainer").innerHTML =
      '<div class="empty-state">No data available for this period</div>'
    return
  }

  const db = new IndexedDBManager()
  let breakdownPeriod = "day"
  if (currentPeriod === "week") breakdownPeriod = "day"
  if (currentPeriod === "month") breakdownPeriod = "week"
  if (currentPeriod === "all") breakdownPeriod = "month"

  const topDocs = getSortedDocuments().slice(0, 5)
  const container = document.getElementById("breakdownContainer")

  const htmlPromises = topDocs.map(async (doc) => {
    const breakdown = await db.getTimeBreakdown(doc.docKey, breakdownPeriod)
    const items = Object.entries(breakdown)
      .sort((a, b) => new Date(b[0]) - new Date(a[0]))
      .map(
        ([date, time]) =>
          `<div class="breakdown-item"><span class="breakdown-date">${formatPeriod(date, breakdownPeriod)}</span><span class="breakdown-time">${db.formatTime(time)}</span></div>`,
      )
      .join("")

    return `<div><h3 style="font-size: 14px; margin-bottom: 8px; color: #6b7280;">${doc.title}</h3>${items}</div>`
  })

  const html = await Promise.all(htmlPromises)
  container.innerHTML = html.join("")
}

function formatDate(isoString) {
  if (!isoString) return "Never"
  const date = new Date(isoString)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)

  const dateOnly = new Date(date)
  dateOnly.setHours(0, 0, 0, 0)

  if (dateOnly.getTime() === today.getTime()) return "Today"
  if (dateOnly.getTime() === yesterday.getTime()) return "Yesterday"

  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

function formatPeriod(dateString, period) {
  const date = new Date(dateString)
  if (period === "day") {
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" })
  } else if (period === "week") {
    const endDate = new Date(date)
    endDate.setDate(endDate.getDate() + 6)
    return `${date.toLocaleDateString("en-US", { month: "short", day: "numeric" })} - ${endDate.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
  } else if (period === "month") {
    return date.toLocaleDateString("en-US", { month: "long", year: "numeric" })
  }
  return dateString
}

function viewDetails(docKey) {
  const doc = allDocuments.find((d) => d.docKey === docKey)
  if (!doc) {
    alert("Document not found")
    return
  }

  const message = `📄 ${doc.title}\n\nTotal Time: ${new IndexedDBManager().formatTime(doc.totalTimeMs)}\nLast Seen: ${formatDate(doc.lastSeen)}\n\nClick OK to see more details`
  alert(message)
}

async function exportData() {
  const db = new IndexedDBManager()
  await db.init()

  const documents = await db.getAllDocuments()
  let csvContent = "Document Title,Total Time (ms),Last Seen,Session Date,Session Duration (ms)\n"

  for (const doc of documents) {
    const docSessions = await db.getSessionsByDocKey(doc.docKey)
    if (docSessions.length === 0) {
      csvContent += `"${doc.title.replace(/"/g, '""')}",${doc.totalTimeMs},"${doc.lastSeen}","",\n`
    } else {
      docSessions.forEach((session, index) => {
        if (index === 0) {
          csvContent += `"${doc.title.replace(/"/g, '""')}",${doc.totalTimeMs},"${doc.lastSeen}","${session.date}",${session.durationMs}\n`
        } else {
          csvContent += `"","","","${session.date}",${session.durationMs}\n`
        }
      })
    }
  }

  const blob = new Blob([csvContent], { type: "text/csv" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `time-tracker-${new Date().toISOString().split("T")[0]}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

async function deleteDocument(docKey) {
  if (!confirm("Are you sure you want to delete this document and all its sessions?")) {
    return
  }

  try {
    const db = new IndexedDBManager()
    await db.init()

    const deleteDocPromise = new Promise((resolve, reject) => {
      const transaction = db.db.transaction(["documents", "sessions"], "readwrite")
      const docStore = transaction.objectStore("documents")
      const sessionStore = transaction.objectStore("sessions")
      const sessionIndex = sessionStore.index("docKey")

      docStore.delete(docKey)

      const sessionRequest = sessionIndex.openCursor(IDBKeyRange.only(docKey))
      sessionRequest.onsuccess = (event) => {
        const cursor = event.target.result
        if (cursor) {
          cursor.delete()
          cursor.continue()
        }
      }

      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })

    await deleteDocPromise
    await loadDocuments()
    alert("Document deleted successfully!")
  } catch (error) {
    console.error("[v0] Delete error:", error)
    alert("Error deleting document: " + error.message)
  }
}
