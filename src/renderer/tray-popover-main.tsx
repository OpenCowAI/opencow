// SPDX-License-Identifier: Apache-2.0

import React from 'react'
import ReactDOM from 'react-dom/client'
import { TrayPopover } from './components/TrayPopover/TrayPopover'
import { initI18n } from './i18n'
import './globals.css'

// Register all translation resources synchronously (before React tree mounts)
initI18n()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <TrayPopover />
  </React.StrictMode>
)
