// SPDX-License-Identifier: Apache-2.0

/**
 * AgentCreatorView — Scene-specific AI Creator for Agents.
 *
 * Thin wrapper around CapabilityCreatorView with agent-specific config.
 * Can be triggered via the UI "AI Create" button or future `/agent-creator` slash command.
 */

import { Bot } from 'lucide-react'
import {
  CapabilityCreatorView,
  type CapabilityCreatorConfig,
  type CapabilityCreatorExternalProps
} from './CapabilityCreatorView'

const AGENT_CREATOR_CONFIG: CapabilityCreatorConfig = {
  category: 'agent',
  icon: Bot,
  iconColor: 'text-purple-500',
  iconGradient: 'bg-gradient-to-br from-purple-500/15 to-indigo-500/10',
  i18nPrefix: 'capabilityCreator.agent',
  suggestionKeys: ['codeReviewer', 'apiArchitect', 'securityAuditor']
}

export function AgentCreatorView(props: CapabilityCreatorExternalProps): React.JSX.Element | null {
  return <CapabilityCreatorView config={AGENT_CREATOR_CONFIG} {...props} />
}
