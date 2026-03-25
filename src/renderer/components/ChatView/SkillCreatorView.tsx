// SPDX-License-Identifier: Apache-2.0

/**
 * SkillCreatorView — Scene-specific AI Creator for Skills.
 *
 * Thin wrapper around CapabilityCreatorView with skill-specific config.
 * Can be triggered via the UI "AI Create" button or future `/skill-creator` slash command.
 */

import { Sparkles } from 'lucide-react'
import {
  CapabilityCreatorView,
  type CapabilityCreatorConfig,
  type CapabilityCreatorExternalProps
} from './CapabilityCreatorView'

const SKILL_CREATOR_CONFIG: CapabilityCreatorConfig = {
  category: 'skill',
  icon: Sparkles,
  iconColor: 'text-violet-500',
  iconGradient: 'bg-gradient-to-br from-violet-500/15 to-purple-500/10',
  i18nPrefix: 'capabilityCreator.skill',
  suggestionKeys: ['codeReview', 'testGeneration', 'documentation']
}

export function SkillCreatorView(props: CapabilityCreatorExternalProps): React.JSX.Element | null {
  return <CapabilityCreatorView config={SKILL_CREATOR_CONFIG} {...props} />
}
