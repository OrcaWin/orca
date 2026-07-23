import { randomUUID } from 'node:crypto'

import { ipcMain } from 'electron'
import type { BrowserWindow } from 'electron'
import type {
  TerminalTabCloseRequest,
  TerminalTabCloseResponse,
  TerminalTabCloseValidationRequest,
  TerminalTabCloseValidationResponse
} from '../../shared/terminal-tab-close'

const TERMINAL_TAB_CLOSE_TIMEOUT_MS = 20_000
const TERMINAL_TAB_CLOSE_VALIDATION_TIMEOUT_MS = 20_000

export async function requestTerminalTabCloseFromRenderer(
  mainWindow: BrowserWindow,
  tabId: string
): Promise<void> {
  if (mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) {
    throw new Error('renderer_unavailable')
  }
  const requestId = randomUUID()
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      ipcMain.removeListener('ui:terminalTabCloseResponse', onResponse)
      reject(new Error('terminal_tab_close_timeout'))
    }, TERMINAL_TAB_CLOSE_TIMEOUT_MS)
    const onResponse = (event: Electron.IpcMainEvent, response: TerminalTabCloseResponse): void => {
      // Why: request IDs are visible to renderer code; only the selected main
      // window may commit or reject its lifecycle transaction.
      if (event.sender !== mainWindow.webContents || response.requestId !== requestId) {
        return
      }
      clearTimeout(timeout)
      ipcMain.removeListener('ui:terminalTabCloseResponse', onResponse)
      if (response.error) {
        reject(new Error(response.error))
      } else {
        resolve()
      }
    }
    ipcMain.on('ui:terminalTabCloseResponse', onResponse)
    const request: TerminalTabCloseRequest = { requestId, tabId }
    mainWindow.webContents.send('ui:terminalTabCloseRequest', request)
  })
}

export function requestTerminalTabCloseValidationFromRenderer(
  mainWindow: BrowserWindow,
  tabId: string,
  expectedPtyIds: string[]
): Promise<void> {
  if (mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) {
    return Promise.reject(new Error('renderer_unavailable'))
  }
  const requestId = randomUUID()
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      ipcMain.removeListener('ui:terminalTabCloseValidationResponse', onResponse)
      reject(new Error('terminal_tab_close_timeout'))
    }, TERMINAL_TAB_CLOSE_VALIDATION_TIMEOUT_MS)
    const onResponse = (
      event: Electron.IpcMainEvent,
      response: TerminalTabCloseValidationResponse
    ): void => {
      // Why: old preloads do not know this channel, so skew fails closed instead of invoking tab-id close.
      if (event.sender !== mainWindow.webContents || response.requestId !== requestId) {
        return
      }
      clearTimeout(timeout)
      ipcMain.removeListener('ui:terminalTabCloseValidationResponse', onResponse)
      if (response.error) {
        reject(new Error(response.error))
      } else {
        resolve()
      }
    }
    ipcMain.on('ui:terminalTabCloseValidationResponse', onResponse)
    const request: TerminalTabCloseValidationRequest = { requestId, tabId, expectedPtyIds }
    try {
      mainWindow.webContents.send('ui:terminalTabCloseValidationRequest', request)
    } catch {
      clearTimeout(timeout)
      ipcMain.removeListener('ui:terminalTabCloseValidationResponse', onResponse)
      reject(new Error('renderer_unavailable'))
    }
  })
}
