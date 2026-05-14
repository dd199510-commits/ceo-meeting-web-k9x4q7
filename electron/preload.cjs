const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('aiScheduler', {
  listJobs: () => ipcRenderer.invoke('ai-jobs:list'),
  getJob: (jobId) => ipcRenderer.invoke('ai-jobs:get', jobId),
  submitJob: (payload) => ipcRenderer.invoke('ai-jobs:submit', payload),
  retryJob: (jobId) => ipcRenderer.invoke('ai-jobs:retry', jobId),
  deleteJob: (jobId) => ipcRenderer.invoke('ai-jobs:delete', jobId),
  registerImportedJob: (payload) => ipcRenderer.invoke('ai-jobs:register-imported', payload),
  getConfig: () => ipcRenderer.invoke('ai-config:get'),
  saveApiKey: (payload) => ipcRenderer.invoke('ai-config:save', payload),
  clearApiKey: (provider) => ipcRenderer.invoke('ai-config:clear', provider),
})
