export type TerminalTabCloseRequest = {
  requestId: string
  tabId: string
}

export type TerminalTabCloseResponse = {
  requestId: string
  error?: string
}

export type TerminalTabCloseValidationRequest = {
  requestId: string
  tabId: string
  expectedPtyIds: string[]
}

export type TerminalTabCloseValidationResponse = {
  requestId: string
  error?: string
}

export type TerminalTabCloseFinalization = {
  tabId: string
  expectedPtyIds: string[]
}
