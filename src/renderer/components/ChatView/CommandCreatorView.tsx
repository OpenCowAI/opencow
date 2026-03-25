// SPDX-License-Identifier: Apache-2.0

/**
 * CommandCreatorView — Scene-specific AI Creator for Commands.
 *
 * Thin wrapper around CapabilityCreatorView with command-specific config.
 * Can be triggered via the UI "AI Create" button or future `/command-creator` slash command.
 */

import { Terminal } from 'lucide-react'
import {
  CapabilityCreatorView,
  type CapabilityCreatorConfig,
  type CapabilityCreatorExternalProps
} from './CapabilityCreatorView'

const COMMAND_CREATOR_CONFIG: CapabilityCreatorConfig = {
  category: 'command',
  icon: Terminal,
  iconColor: 'text-blue-500',
  iconGradient: 'bg-gradient-to-br from-blue-500/15 to-cyan-500/10',
  i18nPrefix: 'capabilityCreator.command',
  suggestionKeys: ['codeReview', 'deployStaging', 'generateTests']
}

export function CommandCreatorView(
  props: CapabilityCreatorExternalProps
): React.JSX.Element | null {
  return <CapabilityCreatorView config={COMMAND_CREATOR_CONFIG} {...props} />
}
