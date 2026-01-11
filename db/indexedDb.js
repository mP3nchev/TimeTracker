export class IndexedDBManager {
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

        // Create documents store
        if (!db.objectStoreNames.contains("documents")) {
          const docStore = db.createObjectStore("documents", { keyPath: "docKey" })
          docStore.createIndex("lastSeen", "lastSeen", { unique: false })
          docStore.createIndex("firstSeen", "firstSeen", { unique: false })
        }

        // Create sessions store
        if (!db.objectStoreNames.contains("sessions")) {
          const sessionStore = db.createObjectStore("sessions", { keyPath: "id", autoIncrement: true })
          sessionStore.createIndex("docKey", "docKey", { unique: false })
          sessionStore.createIndex("date", "date", { unique: false })
          sessionStore.createIndex("docKey_date", ["docKey", "date"], { unique: false })
        }
      }
    })
  }

  async recordSession({ docKey, title, date, durationMs, url }) {
    if (!this.db) await this.init()

    const transaction = this.db.transaction(["documents", "sessions"], "readwrite")
    const docStore = transaction.objectStore("documents")
    const sessionStore = transaction.objectStore("sessions")

    // Get or create document record
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

        // Update or insert document
        docStore.put(docRecord)

        // Insert session record
        const sessionRecord = {
          docKey,
          date,
          durationMs,
          timestamp: new Date().toISOString(),
        }

        sessionStore.add(sessionRecord)

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

  async getSessionsByDateRange(startDate, endDate) {
    if (!this.db) await this.init()

    return new Promise((resolve, reject) => {
      const range = IDBKeyRange.bound(startDate, endDate)
      const index = this.db.transaction("sessions", "readonly").objectStore("sessions").index("date")
      const request = index.getAll(range)

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

      if (!breakdown[key]) {
        breakdown[key] = 0
      }
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
