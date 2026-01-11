// This is a Node.js script to help package the extension
// Run with: node scripts/package.js

const fs = require("fs")
const path = require("path")
const archiver = require("archiver")

const outputFile = path.join(__dirname, "../doc-time-tracker.zip")
const sourceDir = path.join(__dirname, "..")

// Create output stream
const output = fs.createWriteStream(outputFile)
const archive = archiver("zip", {
  zlib: { level: 9 },
})

output.on("close", () => {
  console.log(`Extension packaged successfully: ${outputFile}`)
  console.log(`Total size: ${(archive.pointer() / 1024).toFixed(2)} KB`)
})

archive.on("error", (err) => {
  throw err
})

archive.pipe(output)

// Add files to archive
const filesToInclude = [
  "manifest.json",
  "background.js",
  "content.js",
  "README.md",
  "INSTALLATION.html",
  "popup/popup.html",
  "popup/popup.js",
  "popup/popup.css",
  "dashboard/index.html",
  "dashboard/app.js",
  "dashboard/styles.css",
  "db/indexedDb.js",
]

filesToInclude.forEach((file) => {
  const filePath = path.join(sourceDir, file)
  if (fs.existsSync(filePath)) {
    archive.file(filePath, { name: `doc-time-tracker/${file}` })
  }
})

archive.finalize()
