const fs = require('fs')
const path = require('path')

function sortJobs(jobs = []) {
  return [...jobs].sort((left, right) => {
    const leftTime = new Date(left.updatedAt || left.createdAt || 0).getTime()
    const rightTime = new Date(right.updatedAt || right.createdAt || 0).getTime()
    return rightTime - leftTime
  })
}

class JobStore {
  constructor(app) {
    this.filePath = path.join(app.getPath('userData'), 'ai-jobs.json')
  }

  ensureDirectory() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true })
  }

  readAll() {
    this.ensureDirectory()

    if (!fs.existsSync(this.filePath)) {
      return { jobs: [] }
    }

    try {
      const raw = fs.readFileSync(this.filePath, 'utf8')
      const parsed = JSON.parse(raw)
      return {
        jobs: Array.isArray(parsed.jobs) ? parsed.jobs : [],
      }
    } catch {
      return { jobs: [] }
    }
  }

  writeAll(data) {
    this.ensureDirectory()
    fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf8')
  }

  listJobs() {
    const data = this.readAll()
    return sortJobs(data.jobs)
  }

  getJob(jobId) {
    return this.listJobs().find((job) => job.id === jobId) ?? null
  }

  getRawJob(jobId) {
    const data = this.readAll()
    return (Array.isArray(data.jobs) ? data.jobs : []).find((job) => job.id === jobId) ?? null
  }

  upsertJob(nextJob) {
    const data = this.readAll()
    const jobs = Array.isArray(data.jobs) ? data.jobs : []
    const index = jobs.findIndex((job) => job.id === nextJob.id)

    if (index >= 0) {
      jobs[index] = nextJob
    } else {
      jobs.push(nextJob)
    }

    this.writeAll({ jobs })
    return nextJob
  }
}

module.exports = {
  JobStore,
}
