// SPDX-License-Identifier: Apache-2.0

import type { CapabilityScanner, ScanContext } from './types'
import type { CapabilityCategory } from '@shared/types'

// Scanner imports — added as each scanner is created
import { commandScanner } from './scanners/commandScanner'
import { skillScanner } from './scanners/skillScanner'
import { agentScanner } from './scanners/agentScanner'
import { hookScanner } from './scanners/hookScanner'
import { mcpScanner } from './scanners/mcpScanner'
import { ruleScanner } from './scanners/ruleScanner'
import { pluginScanner } from './scanners/pluginScanner'
import { lspScanner } from './scanners/lspScanner'

/** All registered scanners — adding a new category = add one import + one array entry */
export const scannerRegistry: CapabilityScanner<CapabilityCategory>[] = [
  commandScanner,
  skillScanner,
  agentScanner,
  hookScanner,
  mcpScanner,
  ruleScanner,
  pluginScanner,
  lspScanner,
]
