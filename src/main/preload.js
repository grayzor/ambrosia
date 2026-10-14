// The only bridge between the island / settings pages and Node.
// Pages get `window.ambrosia`; they never touch Node or Electron directly.

const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('ambrosia', {
  /** Subscribe to a main → page channel. Returns an unsubscribe function. */
  on(channel, fn) {
    const handler = (_e, data) => fn(data);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
  /** Call a module action: `ambrosia.action('mail', 'refresh')`. */
  action: (moduleId, name, payload) => ipcRenderer.invoke('action', moduleId, name, payload),
  /** Core commands (settings, quit, hooks install…). */
  core: (name, payload) => ipcRenderer.invoke('core', name, payload),
  /** Fire-and-forget messages to main (mouse capture, layout). */
  send: (channel, data) => ipcRenderer.send(channel, data),
  /** Full path of a File dropped on the island. */
  pathForFile: (file) => webUtils.getPathForFile(file),
});
